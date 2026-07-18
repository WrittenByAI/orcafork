/**
 * Upload a canvas screenshot (PNG) to GitHub so it can be embedded in an
 * issue body as `![...](url)`. GitHub issue bodies don't render `data:` URLs,
 * and Orca has no other image hosting, so screenshots are committed to a
 * dedicated branch via the Contents API and referenced by their raw
 * `download_url`.
 *
 * Mirrors the acquire/release + error-extraction conventions of
 * `createIssue` in `./issues.ts`.
 */
import type { GitHubUploadIssueImageResult, IssueSourcePreference } from '../../shared/types'
import type { LocalGitExecOptions, OwnerRepo } from './gh-utils'
// prettier-ignore
import { ghExecFileAsync, acquire, release, resolveIssueSource, ghRepoExecOptions, githubRepoContext, extractExecError } from './gh-utils'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: a stable, well-known branch keeps canvas screenshots out of the
// user's actual work branches and lets them be garbage-collected/audited as
// a unit later, without needing a new per-repo setting.
const CANVAS_ASSET_BRANCH = 'orca/canvas-screenshots'
const CANVAS_ASSET_DIR = 'orca-canvas'
const FALLBACK_FILE_NAME = 'canvas-screenshot.png'
const DATA_URL_PNG_PREFIX = 'data:image/png;base64,'

function githubImageErrorMessage(error: unknown): string {
  const { stderr, stdout } = extractExecError(error)
  return stderr.trim() || stdout.trim()
}

// Why: a 422 from the ref-creation POST can mean "already exists" (another
// tab/agent raced us to create the branch) which is harmless, or something
// else entirely. Only the "already exists" shape is safe to swallow.
function isRefAlreadyExistsError(message: string): boolean {
  return /already exists/i.test(message)
}

// Why: GitHub rejects file paths with characters outside this safe set, and
// an unsanitized fileName from the renderer (e.g. containing `/` or `..`)
// must never be able to escape the `orca-canvas/` directory.
function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '')
  return sanitized.length > 0 ? sanitized : FALLBACK_FILE_NAME
}

function stripDataUrlPrefix(imageBase64: string): string {
  return imageBase64.startsWith(DATA_URL_PNG_PREFIX)
    ? imageBase64.slice(DATA_URL_PNG_PREFIX.length)
    : imageBase64
}

function isValidBase64(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

// Why: separated from `uploadIssueImage` so the "does the branch exist"
// check and its fallback creation path stay a single readable unit; it
// shares the same acquire()'d gh call budget as its caller.
async function ensureCanvasAssetBranch(
  ownerRepo: OwnerRepo,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<void> {
  const { stdout: repoStdout } = await ghExecFileAsync(
    ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}`],
    ghOptions
  )
  const defaultBranch = (JSON.parse(repoStdout) as { default_branch?: string }).default_branch

  try {
    await ghExecFileAsync(
      ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/git/refs/heads/${CANVAS_ASSET_BRANCH}`],
      ghOptions
    )
    // Branch already exists — nothing to do.
    return
  } catch {
    // Why: gh api on a missing ref exits non-zero; that's the "branch does
    // not exist yet" signal, not a real failure — fall through to create it.
  }

  if (!defaultBranch) {
    throw new Error('Could not resolve default branch for this repository')
  }

  const { stdout: refStdout } = await ghExecFileAsync(
    ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}/git/refs/heads/${defaultBranch}`],
    ghOptions
  )
  const sha = (JSON.parse(refStdout) as { object?: { sha?: string } }).object?.sha
  if (!sha) {
    throw new Error('Could not resolve default branch HEAD sha')
  }

  try {
    await ghExecFileAsync(
      [
        'api',
        '-X',
        'POST',
        `repos/${ownerRepo.owner}/${ownerRepo.repo}/git/refs`,
        '--raw-field',
        `ref=refs/heads/${CANVAS_ASSET_BRANCH}`,
        '--raw-field',
        `sha=${sha}`
      ],
      ghOptions
    )
  } catch (err) {
    const message = githubImageErrorMessage(err)
    if (!isRefAlreadyExistsError(message)) {
      throw err
    }
    // Why: another caller raced us to create the branch between our ref
    // check and this POST — the branch existing is the desired end state.
  }
}

/**
 * Commit a base64-encoded PNG to the `orca/canvas-screenshots` branch at
 * `orca-canvas/<fileName>` via the GitHub Contents API, returning the raw
 * `download_url` for embedding in an issue body.
 *
 * Why the PUT body goes through a temp file: `ghExecFileAsync` does not
 * forward stdin to the `gh` subprocess, and base64-encoded PNGs routinely
 * exceed the ~128KB per-argv-arg limit on Linux, so `--raw-field
 * content=<base64>` is not viable. `gh api --input <file>` reads the JSON
 * request body from disk instead.
 */
export async function uploadIssueImage(
  repoPath: string,
  imageBase64: string,
  fileName: string,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubUploadIssueImageResult> {
  const content = stripDataUrlPrefix(imageBase64.trim())
  if (!isValidBase64(content)) {
    return { ok: false, error: 'Image data must be base64-encoded PNG content' }
  }
  const safeFileName = sanitizeFileName(fileName)

  const context = githubRepoContext(repoPath, connectionId, localGitOptions)
  const ghOptions = ghRepoExecOptions(context)
  const { source: ownerRepo } = await resolveIssueSource(
    repoPath,
    preference,
    connectionId,
    localGitOptions
  )
  if (!ownerRepo) {
    return { ok: false, error: 'Could not resolve GitHub owner/repo for this repository' }
  }

  await acquire()
  try {
    await ensureCanvasAssetBranch(ownerRepo, ghOptions)

    const tempDir = await mkdtemp(join(tmpdir(), 'orca-canvas-'))
    try {
      const bodyPath = join(tempDir, 'body.json')
      await writeFile(
        bodyPath,
        JSON.stringify({
          message: `Add canvas screenshot ${safeFileName}`,
          content,
          branch: CANVAS_ASSET_BRANCH
        })
      )
      const { stdout } = await ghExecFileAsync(
        [
          'api',
          '-X',
          'PUT',
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/contents/${CANVAS_ASSET_DIR}/${safeFileName}`,
          '--input',
          bodyPath
        ],
        ghOptions
      )
      const data = JSON.parse(stdout) as { content?: { download_url?: string } }
      const url = data.content?.download_url
      if (!url) {
        return { ok: false, error: 'Unexpected response from GitHub' }
      }
      return { ok: true, url }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  } catch (err) {
    return { ok: false, error: githubImageErrorMessage(err) }
  } finally {
    release()
  }
}

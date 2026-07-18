import type { Editor } from 'tldraw'
import { translate } from '@/i18n/i18n'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { projectHostSetupProjectionFromRepos } from '../../../../shared/project-host-setup-projection'
import {
  getTaskSourceRuntimeSettings,
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import type {
  GitHubCreateIssueResult,
  GitHubUploadIssueImageResult,
  Repo
} from '../../../../shared/types'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'

// Why: this module drives "screenshot the canvas selection -> file a GitHub
// issue" end to end. It intentionally holds no JSX/React so the dialog
// component (TldrawIssueDialog.tsx) can stay a thin view over it and so the
// dispatch logic (which repo owns a worktree, local vs runtime RPC) is
// testable without mounting a tldraw editor.

export type CapturedCanvasScreenshot = {
  dataUrl: string
  base64: string
  fileName: string
}

/** Renders the current selection to a PNG data URL. Returns null when
 *  nothing is selected — callers should treat that as "no screenshot",
 *  not an error. */
export async function captureSelectionPng(
  editor: Editor
): Promise<CapturedCanvasScreenshot | null> {
  const shapeIds = editor.getSelectedShapeIds()
  if (shapeIds.length === 0) {
    return null
  }
  const { blob } = await editor.toImage(shapeIds, {
    format: 'png',
    background: true,
    padding: 16,
    scale: 2
  })
  const dataUrl = await blobToDataUrl(blob)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const fileName = `canvas-${Date.now()}-${randomHexSuffix(2)}.png`
  return { dataUrl, base64, fileName }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read screenshot blob.'))
    reader.readAsDataURL(blob)
  })
}

// Why: Electron/test runtimes can lack crypto.randomUUID (see
// mint-stable-pane-id.ts); getRandomValues has broader support, with a
// Math.random fallback so this never throws in a non-secure context.
function randomHexSuffix(byteLength: number): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined
  const bytes = new Uint8Array(byteLength)
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type UploadCanvasScreenshotAndCreateIssueParams = {
  worktreeId: string
  title: string
  body: string
  image: { base64: string; fileName: string } | null
}

export type UploadCanvasScreenshotAndCreateIssueResult =
  | { ok: true; number: number; url: string; bodySaveWarning?: string }
  | { ok: false; stage: 'upload'; error: string }
  | { ok: false; stage: 'create'; error: string }

type IssueRepoContext = {
  repo: Repo
  sourceContext: TaskSourceContext | null
  runtimeTarget: RuntimeClientTarget | null
}

// Why: mirrors getTaskPageRepoSourceContext(repo, 'github') in TaskPage.tsx
// (a local, non-exported helper there) so a worktree-scoped caller resolves
// the same source context a repo-picker-scoped one would, using the same
// shared building blocks.
function getRepoGithubSourceContext(repo: Repo): TaskSourceContext | null {
  const projection = projectHostSetupProjectionFromRepos([repo])
  const project = projection.projects[0]
  const setup = projection.setups[0]
  const providerIdentity =
    project?.providerIdentity?.provider === 'github' ? project.providerIdentity : null
  return normalizeTaskSourceContext({
    provider: 'github',
    projectId: setup?.projectId ?? project?.id ?? repo.id,
    hostId: setup?.hostId ?? getRepoExecutionHostId(repo),
    projectHostSetupId: setup?.id,
    repoId: repo.id,
    providerIdentity
  })
}

// Why: replicates TaskPage's newIssueTargetRepo/newIssueSourceContext/
// newIssueRuntimeTarget derivation (~TaskPage.tsx:4124-4152), but keyed off a
// single worktreeId instead of a user-chosen repo from a multi-repo picker.
function resolveIssueRepoContext(worktreeId: string): IssueRepoContext | null {
  if (!worktreeId) {
    return null
  }
  const state = useAppStore.getState()
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const repo = state.repos.find((candidate) => candidate.id === repoId)
  if (!repo) {
    return null
  }
  const sourceContext = getRepoGithubSourceContext(repo)
  const repoOwnerSettings = getSettingsForRepoRuntimeOwner(
    { repos: [repo], settings: state.settings },
    repo.id
  )
  const targetSettings = sourceContext
    ? { ...repoOwnerSettings, ...getTaskSourceRuntimeSettings(sourceContext) }
    : repoOwnerSettings
  const target = getActiveRuntimeTarget(targetSettings)
  const runtimeTarget =
    target.kind === 'environment' && state.repos.some((candidate) => candidate.id === repo.id)
      ? target
      : null
  return { repo, sourceContext, runtimeTarget }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function uploadCanvasScreenshot(
  context: IssueRepoContext,
  image: { base64: string; fileName: string }
): Promise<GitHubUploadIssueImageResult> {
  const { repo, sourceContext, runtimeTarget } = context
  try {
    // Why: matches handleCreateNewIssue's runtime-vs-local dispatch in
    // TaskPage.tsx (~6862-6888) exactly, including the 65s timeout — the
    // upload handler can make up to 4 sequential `gh` calls server-side.
    return runtimeTarget
      ? await callRuntimeRpc<GitHubUploadIssueImageResult>(
          runtimeTarget,
          'github.uploadIssueImage',
          {
            repo: sourceContext?.repoId ?? repo.id,
            imageBase64: image.base64,
            fileName: image.fileName
          },
          { timeoutMs: 65_000 }
        )
      : await window.api.gh.uploadIssueImage({
          repoPath: repo.path,
          repoId: repo.id,
          sourceContext,
          imageBase64: image.base64,
          fileName: image.fileName
        })
  } catch (error) {
    // Why: TaskPage lets a thrown RuntimeRpcCallError become an unhandled
    // rejection (handleCreateNewIssue has no catch); this caller needs a
    // typed result so the dialog can offer "create without screenshot".
    return { ok: false, error: errorMessage(error) }
  }
}

async function createIssueForContext(
  context: IssueRepoContext,
  title: string,
  body: string
): Promise<GitHubCreateIssueResult> {
  const { repo, sourceContext, runtimeTarget } = context
  try {
    return runtimeTarget
      ? await callRuntimeRpc<GitHubCreateIssueResult>(
          runtimeTarget,
          'github.createIssue',
          {
            repo: sourceContext?.repoId ?? repo.id,
            title,
            body
          },
          { timeoutMs: 65_000 }
        )
      : await window.api.gh.createIssue({
          repoPath: repo.path,
          repoId: repo.id,
          sourceContext,
          title,
          body
        })
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** Drives upload -> body assembly -> create issue for a canvas selection.
 *  Pass `image: null` to skip the upload step entirely (e.g. the user chose
 *  "create without screenshot" after an upload failure). */
export async function uploadCanvasScreenshotAndCreateIssue(
  params: UploadCanvasScreenshotAndCreateIssueParams
): Promise<UploadCanvasScreenshotAndCreateIssueResult> {
  const context = resolveIssueRepoContext(params.worktreeId)
  if (!context) {
    return {
      ok: false,
      stage: params.image ? 'upload' : 'create',
      error: translate(
        'auto.components.editor.tldraw.issue.image.a1b46be31d',
        'Could not find the repository for this canvas file.'
      )
    }
  }

  let finalBody = params.body
  if (params.image) {
    const uploadResult = await uploadCanvasScreenshot(context, params.image)
    if (!uploadResult.ok) {
      return { ok: false, stage: 'upload', error: uploadResult.error }
    }
    // Why: raw githubusercontent URLs don't always render inline for viewers
    // without private-repo access, so the plain link is a deliberate
    // duplicate fallback (see plan risk: "private repos").
    finalBody = `${params.body}\n\n![Canvas selection](${uploadResult.url})\n\n[Screenshot](${uploadResult.url})`
  }

  const createResult = await createIssueForContext(context, params.title, finalBody)
  if (!createResult.ok) {
    return { ok: false, stage: 'create', error: createResult.error }
  }
  return {
    ok: true,
    number: createResult.number,
    url: createResult.url,
    bodySaveWarning: createResult.bodySaveWarning
  }
}

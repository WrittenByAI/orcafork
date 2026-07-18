import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GhUtils from './gh-utils'

const { ghExecFileAsyncMock, resolveIssueSourceMock, acquireMock, releaseMock } = vi.hoisted(
  () => ({
    ghExecFileAsyncMock: vi.fn(),
    resolveIssueSourceMock: vi.fn(),
    acquireMock: vi.fn(),
    releaseMock: vi.fn()
  })
)

vi.mock('./gh-utils', async () => {
  const actual = await vi.importActual<typeof GhUtils>('./gh-utils')
  return {
    ...actual,
    ghExecFileAsync: ghExecFileAsyncMock,
    resolveIssueSource: resolveIssueSourceMock,
    acquire: acquireMock,
    release: releaseMock
  }
})

import { uploadIssueImage } from './issue-images'

const OWNER_REPO = { owner: 'stablyai', repo: 'orca' }
const VALID_BASE64 = 'aGVsbG8gd29ybGQ=' // "hello world"

describe('uploadIssueImage', () => {
  beforeEach(() => {
    ghExecFileAsyncMock.mockReset()
    resolveIssueSourceMock.mockReset()
    acquireMock.mockReset()
    releaseMock.mockReset()
    acquireMock.mockResolvedValue(undefined)
    resolveIssueSourceMock.mockResolvedValue({ source: OWNER_REPO, fellBack: false })
  })

  it('uploads to an existing canvas asset branch and returns the download url', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ ref: 'refs/heads/orca/canvas-screenshots' })
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          content: {
            download_url:
              'https://raw.githubusercontent.com/stablyai/orca/orca/canvas-screenshots/orca-canvas/shot.png'
          }
        })
      })

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({
      ok: true,
      url: 'https://raw.githubusercontent.com/stablyai/orca/orca/canvas-screenshots/orca-canvas/shot.png'
    })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(3)
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(1, ['api', 'repos/stablyai/orca'], {
      cwd: '/repo-root'
    })
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      ['api', 'repos/stablyai/orca/git/refs/heads/orca/canvas-screenshots'],
      { cwd: '/repo-root' }
    )
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      [
        'api',
        '-X',
        'PUT',
        'repos/stablyai/orca/contents/orca-canvas/shot.png',
        '--input',
        expect.stringContaining('body.json')
      ],
      { cwd: '/repo-root' }
    )
    expect(acquireMock).toHaveBeenCalledTimes(1)
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })

  it('creates the canvas asset branch from the default branch HEAD when missing', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ object: { sha: 'abc123' } }) })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          content: { download_url: 'https://raw.githubusercontent.com/stablyai/orca/x/shot.png' }
        })
      })

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({
      ok: true,
      url: 'https://raw.githubusercontent.com/stablyai/orca/x/shot.png'
    })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(5)
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      ['api', 'repos/stablyai/orca/git/refs/heads/main'],
      { cwd: '/repo-root' }
    )
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      4,
      [
        'api',
        '-X',
        'POST',
        'repos/stablyai/orca/git/refs',
        '--raw-field',
        'ref=refs/heads/orca/canvas-screenshots',
        '--raw-field',
        'sha=abc123'
      ],
      { cwd: '/repo-root' }
    )
  })

  it('tolerates a 422 already-exists race when creating the branch', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ object: { sha: 'abc123' } }) })
      .mockRejectedValueOnce(new Error('HTTP 422: Reference already exists'))
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          content: { download_url: 'https://raw.githubusercontent.com/stablyai/orca/x/shot.png' }
        })
      })

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({
      ok: true,
      url: 'https://raw.githubusercontent.com/stablyai/orca/x/shot.png'
    })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(5)
  })

  it('fails when the branch is missing and the default branch cannot be resolved', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({}) })
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'))

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({
      ok: false,
      error: 'Could not resolve default branch for this repository'
    })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('propagates a non-race error when creating the branch fails', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ object: { sha: 'abc123' } }) })
      .mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'))

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({ ok: false, error: 'HTTP 500: Internal Server Error' })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(4)
  })

  it('rejects empty image data without calling gh or resolving the repo', async () => {
    const result = await uploadIssueImage('/repo-root', '', 'shot.png')

    expect(result).toEqual({
      ok: false,
      error: 'Image data must be base64-encoded PNG content'
    })
    expect(resolveIssueSourceMock).not.toHaveBeenCalled()
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
    expect(acquireMock).not.toHaveBeenCalled()
  })

  it('rejects non-base64 image data', async () => {
    const result = await uploadIssueImage('/repo-root', 'not base64!! ###', 'shot.png')

    expect(result).toEqual({
      ok: false,
      error: 'Image data must be base64-encoded PNG content'
    })
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('strips a data: URL prefix before validating and uploading', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ content: { download_url: 'https://example.com/shot.png' } })
      })

    const result = await uploadIssueImage(
      '/repo-root',
      `data:image/png;base64,${VALID_BASE64}`,
      'shot.png'
    )

    expect(result).toEqual({ ok: true, url: 'https://example.com/shot.png' })
  })

  it('handles large image payloads via a temp file instead of argv', async () => {
    const largeBase64 = 'A'.repeat(200_000)
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ content: { download_url: 'https://example.com/big.png' } })
      })

    const result = await uploadIssueImage('/repo-root', largeBase64, 'big.png')

    expect(result).toEqual({ ok: true, url: 'https://example.com/big.png' })
    const putArgs = ghExecFileAsyncMock.mock.calls[2][0] as string[]
    expect(putArgs).not.toContain(largeBase64)
    expect(putArgs.some((arg) => arg.includes(largeBase64))).toBe(false)
    expect(putArgs).toContain('--input')
  })

  it('sanitizes unsafe characters out of the file name', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ content: { download_url: 'https://example.com/shot.png' } })
      })

    await uploadIssueImage('/repo-root', VALID_BASE64, '../../my screenshot!.png')

    const putArgs = ghExecFileAsyncMock.mock.calls[2][0] as string[]
    expect(putArgs[3]).toBe('repos/stablyai/orca/contents/orca-canvas/....myscreenshot.png')
  })

  it('falls back to a default file name when sanitization empties it', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ content: { download_url: 'https://example.com/shot.png' } })
      })

    await uploadIssueImage('/repo-root', VALID_BASE64, '???///')

    const putArgs = ghExecFileAsyncMock.mock.calls[2][0] as string[]
    expect(putArgs[3]).toBe('repos/stablyai/orca/contents/orca-canvas/canvas-screenshot.png')
  })

  it('returns an error when the repo owner/repo cannot be resolved', async () => {
    resolveIssueSourceMock.mockResolvedValueOnce({ source: null, fellBack: false })

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({
      ok: false,
      error: 'Could not resolve GitHub owner/repo for this repository'
    })
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('returns an error when the Contents API response has no download_url', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ content: {} }) })

    const result = await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png')

    expect(result).toEqual({ ok: false, error: 'Unexpected response from GitHub' })
  })

  it('routes local WSL execution options through every gh call', async () => {
    const localGitOptions = { wslDistro: 'Ubuntu' }
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: JSON.stringify({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ref: 'refs/heads/x' }) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ content: { download_url: 'https://example.com/shot.png' } })
      })

    await uploadIssueImage('/repo-root', VALID_BASE64, 'shot.png', undefined, null, localGitOptions)

    expect(ghExecFileAsyncMock.mock.calls.every((call) => call[1]?.wslDistro === 'Ubuntu')).toBe(
      true
    )
    expect(resolveIssueSourceMock).toHaveBeenCalledWith(
      '/repo-root',
      undefined,
      null,
      localGitOptions
    )
  })
})

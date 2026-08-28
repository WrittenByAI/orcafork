import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: outside Electron the mock has no net.fetch, so the client falls back to
// global fetch, which these tests stub.
vi.mock('electron', () => ({ net: undefined }))

import { CODEX_SIGN_IN_MESSAGE, CodexTranscriptionSession } from './codex-transcription-client'

const AUTH = { accessToken: 'token-123', accountId: 'acct-1' }

function feedSecondOfAudio(session: CodexTranscriptionSession): void {
  session.feedAudio(new Float32Array(16000), 16000)
}

describe('CodexTranscriptionSession', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns empty text without a network call when no audio was fed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const session = new CodexTranscriptionSession(() => AUTH)

    await expect(session.finish()).resolves.toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the recording to the codex transcribe backend with codex auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: ' hello world ' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new CodexTranscriptionSession(() => AUTH)
    feedSecondOfAudio(session)

    await expect(session.finish()).resolves.toBe('hello world')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/transcribe')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-123')
    expect(headers['ChatGPT-Account-Id']).toBe('acct-1')
    expect(headers.originator).toBe('codex_desktop')
    const file = (init.body as FormData).get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as Blob).size).toBeGreaterThan(44)
  })

  it('omits the account header when auth.json has no account id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const session = new CodexTranscriptionSession(() => ({ ...AUTH, accountId: null }))
    feedSecondOfAudio(session)

    await session.finish()
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['ChatGPT-Account-Id']).toBeUndefined()
  })

  it('asks the user to sign in when auth.json is missing or the token is rejected', async () => {
    const session = new CodexTranscriptionSession(() => null)
    feedSecondOfAudio(session)
    await expect(session.finish()).rejects.toThrow(CODEX_SIGN_IN_MESSAGE)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))
    const rejected = new CodexTranscriptionSession(() => AUTH)
    feedSecondOfAudio(rejected)
    await expect(rejected.finish()).rejects.toThrow(CODEX_SIGN_IN_MESSAGE)
  })

  it('redacts bearer tokens from backend error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('failed for Bearer sk-secret-token', { status: 500 }))
    )
    const session = new CodexTranscriptionSession(() => AUTH)
    feedSecondOfAudio(session)

    await expect(session.finish()).rejects.toThrow(/Codex transcription failed \(500\)/)
    await expect(async () => {
      const retry = new CodexTranscriptionSession(() => AUTH)
      feedSecondOfAudio(retry)
      await retry.finish()
    }).rejects.not.toThrow(/sk-secret-token/)
  })
})

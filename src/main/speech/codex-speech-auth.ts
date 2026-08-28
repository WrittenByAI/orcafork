import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type CodexSpeechAuth = {
  accessToken: string
  accountId: string | null
}

function getCodexAuthPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return join(codexHome || join(homedir(), '.codex'), 'auth.json')
}

/**
 * Why: codex rotates auth.json in place, so the token is read per transcription
 * request instead of being cached at session start.
 */
export function readCodexSpeechAuth(): CodexSpeechAuth | null {
  try {
    const parsed = JSON.parse(readFileSync(getCodexAuthPath(), 'utf8')) as {
      tokens?: { access_token?: unknown; account_id?: unknown }
    }
    const accessToken = parsed.tokens?.access_token
    if (typeof accessToken !== 'string' || accessToken === '') {
      return null
    }
    const accountId = parsed.tokens?.account_id
    return {
      accessToken,
      accountId: typeof accountId === 'string' && accountId !== '' ? accountId : null
    }
  } catch {
    return null
  }
}

export function hasCodexSpeechAuth(): boolean {
  // Why: model-state refresh polls this on settings open; existence is enough
  // and skips parsing a file codex may be rewriting concurrently.
  return existsSync(getCodexAuthPath())
}

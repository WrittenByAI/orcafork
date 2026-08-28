import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasCodexSpeechAuth, readCodexSpeechAuth } from './codex-speech-auth'

let codexHome: string | null = null

function withCodexHome(authJson: string | null): void {
  codexHome = mkdtempSync(join(tmpdir(), 'codex-speech-auth-'))
  process.env.CODEX_HOME = codexHome
  if (authJson !== null) {
    writeFileSync(join(codexHome, 'auth.json'), authJson)
  }
}

afterEach(() => {
  delete process.env.CODEX_HOME
  if (codexHome) {
    rmSync(codexHome, { recursive: true, force: true })
    codexHome = null
  }
})

describe('readCodexSpeechAuth', () => {
  it('reads the access token and account id from CODEX_HOME/auth.json', () => {
    withCodexHome(JSON.stringify({ tokens: { access_token: 'tok', account_id: 'acct' } }))
    expect(readCodexSpeechAuth()).toEqual({ accessToken: 'tok', accountId: 'acct' })
    expect(hasCodexSpeechAuth()).toBe(true)
  })

  it('returns null for a missing, malformed, or tokenless auth.json', () => {
    withCodexHome(null)
    expect(readCodexSpeechAuth()).toBeNull()
    expect(hasCodexSpeechAuth()).toBe(false)

    writeFileSync(join(codexHome!, 'auth.json'), 'not json')
    expect(readCodexSpeechAuth()).toBeNull()

    writeFileSync(join(codexHome!, 'auth.json'), JSON.stringify({ tokens: {} }))
    expect(readCodexSpeechAuth()).toBeNull()
  })
})

import { net } from 'electron'
import { resampleToRate } from './stt-audio-resample'
import {
  CLOUD_TRANSCRIPTION_SAMPLE_RATE,
  MAX_CLOUD_AUDIO_SECONDS,
  combineChunks,
  encodePcm16Wav
} from './cloud-transcription-wav'
import { readCodexSpeechAuth, type CodexSpeechAuth } from './codex-speech-auth'

const CODEX_TRANSCRIPTION_URL = 'https://chatgpt.com/backend-api/transcribe'
// Why: the transcribe backend serves the Codex desktop app; mirror its
// originator and User-Agent so requests are attributed like that client's.
const CODEX_ORIGINATOR = 'codex_desktop'
const CODEX_USER_AGENT = 'Codex Desktop/26.611.62324'

export const CODEX_SIGN_IN_MESSAGE =
  'Codex transcription needs a signed-in Codex account. Run `codex login` and try again.'

function sanitizeCodexTranscriptionErrorDetail(detail: string): string {
  return detail
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9._-]{20,}/g, '[redacted]')
    .slice(0, 300)
    .trim()
}

export class CodexTranscriptionSession {
  private chunks: Float32Array[] = []
  private audioSeconds = 0

  constructor(private readonly readAuth: () => CodexSpeechAuth | null = readCodexSpeechAuth) {}

  feedAudio(samples: Float32Array, sampleRate: number): void {
    const normalized = resampleToRate(samples, sampleRate, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
    this.audioSeconds += normalized.length / CLOUD_TRANSCRIPTION_SAMPLE_RATE
    if (this.audioSeconds > MAX_CLOUD_AUDIO_SECONDS) {
      throw new Error('Cloud transcription is limited to 10 minutes per dictation')
    }
    this.chunks.push(new Float32Array(normalized))
  }

  async finish(): Promise<string> {
    if (this.chunks.length === 0) {
      return ''
    }

    const auth = this.readAuth()
    if (!auth) {
      throw new Error(CODEX_SIGN_IN_MESSAGE)
    }

    const audio = combineChunks(this.chunks)
    this.chunks = []
    const wav = encodePcm16Wav(audio, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'dictation.wav')

    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
      originator: CODEX_ORIGINATOR,
      'User-Agent': CODEX_USER_AGENT
    }
    if (auth.accountId) {
      headers['ChatGPT-Account-Id'] = auth.accountId
    }

    // Why: chatgpt.com sits behind TLS-fingerprint filtering that rejects
    // Node's fetch with 403; Electron's net.fetch uses the Chromium network
    // stack (and the system proxy), matching how Codex Desktop itself connects.
    const fetchImpl = net?.fetch ?? fetch
    const response = await fetchImpl(CODEX_TRANSCRIPTION_URL, {
      method: 'POST',
      headers,
      body: form
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(CODEX_SIGN_IN_MESSAGE)
      }
      const detail = sanitizeCodexTranscriptionErrorDetail(await response.text().catch(() => ''))
      throw new Error(
        `Codex transcription failed (${response.status})${detail ? `: ${detail}` : ''}`
      )
    }

    const data = (await response.json().catch(() => ({}))) as { text?: unknown }
    if (typeof data.text !== 'string') {
      throw new Error('Codex transcription response did not include text')
    }
    return data.text.trim()
  }
}

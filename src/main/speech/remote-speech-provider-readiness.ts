import type { SpeechModelManifest, SpeechModelState } from '../../shared/speech-types'
import { hasCodexSpeechAuth } from './codex-speech-auth'
import { hasOpenAiSpeechApiKey } from './openai-api-key-store'

/**
 * Why: remote providers never land files on disk, so their readiness is a
 * credential check rather than a model-directory scan. Returns null for local
 * models, which the caller resolves from the filesystem instead.
 */
export function getRemoteSpeechProviderState(
  modelId: string,
  manifest: SpeechModelManifest
): SpeechModelState | null {
  if (manifest.provider === 'openai') {
    return { id: modelId, status: hasOpenAiSpeechApiKey() ? 'ready' : 'not-downloaded' }
  }
  if (manifest.provider === 'codex') {
    return { id: modelId, status: hasCodexSpeechAuth() ? 'ready' : 'not-downloaded' }
  }
  return null
}

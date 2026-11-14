/**
 * Google's Gemini text to speech on KIE (market tasks, one per request).
 *
 * The request is a list of speakers and an ordered list of turns. A speaker
 * names its voice (`voice_name`) and, on 3.1 Flash / 2.5 Pro, its style, pace,
 * accent and audio profile; a turn carries its text and, on 3.8, its own
 * free-text style. Which of the two a model takes is its capability sheet's
 * (`TtsCapabilities.direction`): free text ⇒ on the turn, a choice ⇒ on the
 * speaker. One speaker and one turn for text to speech; two speakers and
 * their turns in order for a dialogue (`filler_words` on a model that takes
 * it, with exactly two speakers). A speaker's voice is where a one-off clone
 * (`replica`) would go instead of a name.
 *
 * Nothing here reads a request: the caller hands over text already in the
 * model's tag syntax (`speakableText`), a voice the model speaks
 * (`ttsNamedVoiceFor`) and the direction the model takes (`ttsDirectionFor`).
 * Fields KIE's schema does not name are never sent.
 */
import { getTtsCapabilities, ttsDirection, type TtsDirectionValues } from "@nodaro/shared/model-catalog"
import { createSanitizedError, runKieTask, MAX_POLL_ATTEMPTS } from "./client.js"
import { KIE_TTS_MODELS } from "./models.js"
import { kieTaskCreditsConsumed } from "./image-cost.js"
import type { ReconcileOpts } from "../provider.interface.js"

/** One voice in the request: a named voice, or a one-off clone of a speaker (`replica`), never both. */
export interface GeminiSpeaker {
  /** The voice's wire name (one of the model's `voices`). Ignored when `replica` is given. */
  readonly voice: string
  /**
   * A one-off clone (3.8 Flash, decided 2026-11-13): the two recordings' links as KIE fetches them — the
   * job's scratch copies (`lib/voice-replica.ts`), never the caller's links. Sent in place of `voice_name`.
   */
  readonly replica?: { readonly sourceAudioUrl: string; readonly consentAudioUrl: string }
  /** The speaker's direction: on 3.1 / 2.5 its style, pace, accent and audio profile (3.8's style rides on each turn). */
  readonly direction?: TtsDirectionValues
}

/** One line, spoken by `speakers[speaker]`. */
export interface GeminiTurn {
  readonly speaker: number
  readonly text: string
  /** 3.8's free-text style for this line. */
  readonly style?: string
}

const speakerId = (index: number): string => `Speaker ${index + 1}`

/** Request-wide options. */
export interface GeminiSpeechOptions {
  /** Let the model add filler words between two speakers (sent only on a model whose sheet takes it, with exactly two speakers). */
  readonly fillerWords?: boolean
}

/**
 * KIE's `input` for a request on `provider`. Each direction field goes where
 * the model's sheet says it is taken, and only there.
 */
export function geminiSpeechInput(provider: string, speakers: readonly GeminiSpeaker[], turns: readonly GeminiTurn[], options: GeminiSpeechOptions = {}): Record<string, unknown> {
  const sheet = ttsDirection(provider) ?? {}
  const perSpeakerStyle = sheet.styles !== undefined
  const fillerWords = options.fillerWords === true && speakers.length === 2 && getTtsCapabilities(provider).fillerWords === true
  return {
    ...(fillerWords ? { filler_words: true } : {}),
    speakers: speakers.map((s, i) => {
      const d = s.direction ?? {}
      return {
        speaker_id: speakerId(i),
        // KIE: `voice_name` and `replica` are mutually exclusive on a speaker.
        ...(s.replica
          ? { replica: { source_audio_url: s.replica.sourceAudioUrl, consent_audio_url: s.replica.consentAudioUrl } }
          : { voice_name: s.voice }),
        ...(perSpeakerStyle && d.styleDirection ? { style: d.styleDirection } : {}),
        ...(sheet.paces && d.pace ? { pace: d.pace } : {}),
        ...(sheet.accents && d.accent ? { accent: d.accent } : {}),
        ...(sheet.audioProfileMaxChars !== undefined && d.audioProfile ? { audio_profile: d.audioProfile } : {}),
      }
    }),
    dialogue_turns: turns.map((t) => ({
      speaker_id: speakerId(t.speaker),
      text: t.text,
      ...(!perSpeakerStyle && sheet.styleMaxChars !== undefined && t.style ? { style: t.style } : {}),
    })),
  }
}

/** What a finished Gemini speech task delivered. */
export interface GeminiSpeechResult {
  /** KIE's WAV (24 kHz, mono, 16-bit). */
  readonly url: string
  /** The KIE credits the task consumed, when its record says. */
  readonly kieCredits?: number
  readonly providerMs?: number
}

/**
 * Run one Gemini speech task to the end. `reconcileOpts.onTaskCreated`
 * records the task on the job, so a worker that dies mid-run leaves a task
 * the reconcile can deliver (lib/reconcile/kie.ts → `recoveredGeminiSpeech`).
 */
export async function runGeminiSpeech(
  provider: string,
  input: Record<string, unknown>,
  reconcileOpts?: ReconcileOpts,
): Promise<GeminiSpeechResult> {
  const config = KIE_TTS_MODELS[provider]
  if (!config) throw createSanitizedError(`does not support TTS provider: ${provider}`, "Speech generation")
  const characters = (input.dialogue_turns as Array<{ text: string }>).reduce((n, t) => n + t.text.length, 0)
  const { resultJson, rawRecordInfo, providerMs } = await runKieTask(config.model, input, MAX_POLL_ATTEMPTS, undefined, {
    ...reconcileOpts,
    modelKey: provider,
    dimensions: { ...reconcileOpts?.dimensions, characters },
  })
  const url = resultJson.resultUrls?.[0] ?? resultJson.audioUrl
  if (!url) throw createSanitizedError("TTS task succeeded but no URL found", "Speech generation")
  const kieCredits = kieTaskCreditsConsumed(rawRecordInfo)
  return { url, ...(kieCredits !== undefined && { kieCredits }), ...(providerMs !== undefined && { providerMs }) }
}

/**
 * Aggregator that walks a consumer node's `audio-style` target handle, collects
 * incoming Sound parameter nodes, and composes a SoundComposition (text +
 * optional structured fields + warnings) used to enrich the consumer's prompt
 * fields. Parallel to how cinematography hints aggregate via
 * `collectCinematographyHints` in front+back, but exposes structured-field
 * outputs for typed targets like MiniMax (genre/mood/instrumental).
 *
 * Called from:
 *   - frontend: `frontend/src/lib/audio-style-hints.ts` (canvas executor)
 *   - backend:  `backend/src/services/workflow-engine/payload-builder.ts`
 */

import type { HintGraphContext, HintNodeLike } from "./parameter-prompt-hint.js"
import { getParameterPromptHint } from "./parameter-prompt-hint.js"
import { getMusicGenre, getMusicEra } from "./music-genre.js"
import { getMusicEnergy, getMusicEmotion, getMusicVibe } from "./music-mood.js"

export type SoundConsumerType =
  | "suno-generate"
  | "generate-music"
  | "voice-design"
  | "text-to-audio"

export interface SoundCompositionFields {
  readonly genre?: string
  readonly mood?: string
  readonly instrumental?: boolean
  readonly voiceDescription?: string
  /**
   * Suno's binary vocal-gender control. Extracted from a connected
   * voice-character node's `gender` field when it's "male" or "female"
   * ("androgynous" is left to prompt-only since Suno doesn't accept it).
   * Set on suno-generate and generate-music consumers.
   */
  readonly vocalGender?: "male" | "female"
}

export interface SoundComposition {
  readonly text: string
  readonly fields: SoundCompositionFields
  readonly warnings: ReadonlyArray<string>
}

const MUSIC_TYPES = new Set(["music-genre", "music-mood", "instrumentation"])
const VOICE_TYPES = new Set(["voice-character", "voice-delivery"])

function isMusic(t: string | undefined) { return !!t && MUSIC_TYPES.has(t) }
function isVoice(t: string | undefined) { return !!t && VOICE_TYPES.has(t) }

function collectAudioStyleSources(
  consumer: HintNodeLike,
  ctx: HintGraphContext,
): HintNodeLike[] {
  const sources: HintNodeLike[] = []
  for (const edge of ctx.edges) {
    if (edge.target !== consumer.id) continue
    if (edge.targetHandle !== "audio-style") continue
    const source = ctx.nodes.find((n) => n.id === edge.source)
    if (source) sources.push(source)
  }
  return sources
}

export function composeSoundHintFromConnections(
  consumer: HintNodeLike,
  consumerType: SoundConsumerType,
  ctx: HintGraphContext,
): SoundComposition {
  const sources = collectAudioStyleSources(consumer, ctx)
  if (sources.length === 0) {
    return { text: "", fields: {}, warnings: [] }
  }

  const warnings: string[] = []
  const acceptedHints: string[] = []
  const fields: SoundCompositionFields = {}

  // Identify which sources are accepted vs warned-about by consumer type.
  //
  // Music consumers (suno-generate, generate-music) accept BOTH music nodes
  // AND voice nodes — voice description (gender, age, accent, language,
  // timbre, delivery archetype) is valid input for music with vocals. Suno
  // V5 in particular benefits from rich voice description; the typed
  // `vocalGender` field on Suno is also extracted below from voice-character.
  //
  // Voice Design rejects music nodes (different domain). Text-to-Audio
  // (sound effects) rejects voice nodes (sound effects aren't vocal).
  for (const src of sources) {
    const t = src.type
    if (consumerType === "voice-design") {
      if (isMusic(t)) {
        warnings.push(`Music nodes (${t}) are ignored on Voice Design.`)
        continue
      }
    }
    if (consumerType === "text-to-audio") {
      if (isVoice(t)) {
        warnings.push(`Voice nodes (${t}) are ignored on Text to Audio.`)
        continue
      }
    }

    const hint = getParameterPromptHint(src)
    if (hint) acceptedHints.push(hint)

    // Music consumers — extract vocalGender from connected voice-character
    // node (when gender is "male" or "female"; "androgynous" doesn't map to
    // Suno's binary vocalGender field, so it's left to the prompt-only path).
    // Applies to BOTH suno-generate and generate-music since the Suno
    // provider routes both.
    if (
      (consumerType === "suno-generate" || consumerType === "generate-music") &&
      t === "voice-character" &&
      src.data
    ) {
      const gender = (src.data as Record<string, unknown>).gender
      if ((gender === "male" || gender === "female") && !fields.vocalGender) {
        Object.assign(fields, { vocalGender: gender })
      }
    }

    // Generate Music — populate typed fields when provider is minimax.
    if (consumerType === "generate-music" && consumer.data && (consumer.data as Record<string, unknown>).provider === "minimax") {
      const data = src.data as Record<string, unknown> | undefined
      if (t === "music-genre" && data) {
        const sub = typeof data.subgenre === "string" ? data.subgenre : undefined
        const genreId = typeof data.genre === "string" ? data.genre : undefined
        const eraId = typeof data.era === "string" ? data.era : undefined
        const eraHint = getMusicEra(eraId)?.promptHint
        const genre = getMusicGenre(genreId)
        const subHint = genre?.subgenres.find((s) => s.id === sub)?.promptHint ?? genre?.promptHint
        const composed = [eraHint, subHint].filter(Boolean).join(" ")
        if (composed && !fields.genre) Object.assign(fields, { genre: composed })
      }
      if (t === "music-mood" && data) {
        const energyHint = getMusicEnergy(typeof data.energy === "string" ? data.energy : undefined)?.promptHint
        const emotionHint = getMusicEmotion(typeof data.emotion === "string" ? data.emotion : undefined)?.promptHint
        const vibeHint = getMusicVibe(typeof data.vibe === "string" ? data.vibe : undefined)?.promptHint
        const composed = [energyHint, emotionHint, vibeHint].filter(Boolean).join(" ")
        if (composed && !fields.mood) Object.assign(fields, { mood: composed })
      }
      if (t === "instrumentation" && data) {
        const vp = typeof data.vocalPresence === "string" ? data.vocalPresence : undefined
        if (vp === "instrumental") Object.assign(fields, { instrumental: true })
      }
    }
  }

  const text = acceptedHints.join(", ")

  // Voice Design: also surface the composed text as voiceDescription.
  if (consumerType === "voice-design" && text) {
    Object.assign(fields, { voiceDescription: text })
  }

  return { text, fields, warnings }
}

/**
 * Append `composedText` to `userText` with ", " separator. Empty inputs
 * are tolerated; the non-empty side is returned alone.
 */
export function appendField(userText: string, composedText: string): string {
  if (!composedText) return userText
  if (!userText) return composedText
  return `${userText}, ${composedText}`
}

/**
 * Truncate `composedText` so the final string `userText + ", " + composedText`
 * fits within `maxTotalLen`. Returns "" when the budget is non-positive (user
 * text already at limit). Cuts on word boundary when possible.
 */
export function truncateForField(composedText: string, userText: string, maxTotalLen: number): string {
  if (!composedText) return ""
  const sepLen = userText.length > 0 ? 2 : 0
  const budget = maxTotalLen - userText.length - sepLen
  if (budget <= 0) return ""
  if (composedText.length <= budget) return composedText
  const cut = composedText.slice(0, budget)
  const ws = cut.lastIndexOf(" ")
  return ws > 0 ? cut.slice(0, ws) : cut
}

/**
 * Suno Generate auto-detects custom mode when the user typed style/title/lyrics,
 * even without explicitly toggling `customMode`. The frontend executor, backend
 * payload-builder, and the FinalAudioPromptPreview all need to agree on the
 * resolved value or the preview lies about which field receives the audio-style
 * hint.
 *
 * Accepts an unknown-keyed record so callers in both the typed frontend
 * (SunoGenerateData) and the loosely-typed backend (WorkflowNodeData with
 * `[k: string]: unknown`) can hand the node `data` straight in without casts.
 */
export function getEffectiveSunoCustomMode(
  data: { readonly [k: string]: unknown },
): boolean {
  if (typeof data.customMode === "boolean") return data.customMode
  return !!(data.style || data.title || data.lyrics)
}

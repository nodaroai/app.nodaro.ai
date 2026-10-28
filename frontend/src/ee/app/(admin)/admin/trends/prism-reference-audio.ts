// The Prism reference audio, a mode per output resolution, as the admin
// screens read and write it. A resolution left out is the full audio. A value
// saved before the setting was per resolution is a plain mode, meaning that
// mode at every resolution (the server reads it the same way:
// backend/src/lib/cast-swap-prism-reference-audio.ts).

import { CAST_SWAP_RESOLUTIONS_BY_ENGINE } from "@nodaro/shared/models"
import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId, TrendResolution } from "@/lib/api"

/** The resolutions a Prism run renders, in the order the screens show them (its 480p draft first). */
export const PRISM_RESOLUTIONS: readonly TrendResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE["seedance-2-5"]

export const PRISM_REFERENCE_AUDIO_MODES: readonly CastSwapPrismReferenceAudioId[] = ["full", "voice", "none"]

export const DEFAULT_PRISM_REFERENCE_AUDIO: CastSwapPrismReferenceAudioId = "full"

/** Every resolution's mode, the full audio where none is set. */
export type PrismReferenceAudioTriple = Readonly<Record<TrendResolution, CastSwapPrismReferenceAudioId>>

function isMode(v: unknown): v is CastSwapPrismReferenceAudioId {
  return typeof v === "string" && (PRISM_REFERENCE_AUDIO_MODES as readonly string[]).includes(v)
}

/**
 * A stored value as the per-resolution object: a plain mode as that mode at
 * every resolution, an object's known resolutions with a known mode, else
 * undefined (none set: the full audio).
 */
export function prismReferenceAudioByResolutionOf(value: unknown): CastSwapPrismReferenceAudioByResolution | undefined {
  if (isMode(value)) return Object.fromEntries(PRISM_RESOLUTIONS.map((r) => [r, value]))
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const rec = value as Record<string, unknown>
  const out: CastSwapPrismReferenceAudioByResolution = {}
  for (const r of PRISM_RESOLUTIONS) {
    const mode = rec[r]
    if (isMode(mode)) out[r] = mode
  }
  return out
}

/** Every resolution's mode (`DEFAULT_PRISM_REFERENCE_AUDIO` where none is set). */
export function prismReferenceAudioTriple(value: unknown): PrismReferenceAudioTriple {
  const byRes = prismReferenceAudioByResolutionOf(value) ?? {}
  return Object.fromEntries(PRISM_RESOLUTIONS.map((r) => [r, byRes[r] ?? DEFAULT_PRISM_REFERENCE_AUDIO])) as PrismReferenceAudioTriple
}

/** Only the resolutions that are not the full audio, in resolution order; undefined when every one is. */
export function prismReferenceAudioNotFull(value: unknown): CastSwapPrismReferenceAudioByResolution | undefined {
  const triple = prismReferenceAudioTriple(value)
  const out: CastSwapPrismReferenceAudioByResolution = {}
  for (const r of PRISM_RESOLUTIONS) if (triple[r] !== DEFAULT_PRISM_REFERENCE_AUDIO) out[r] = triple[r]
  return Object.keys(out).length > 0 ? out : undefined
}

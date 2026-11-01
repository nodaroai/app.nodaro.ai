// The Prism reference audio, a mode per output resolution, as the admin
// screens read and write it. A resolution left out is the full audio. A value
// saved before the setting was per resolution is a plain mode, meaning that
// mode at every resolution (the server reads it the same way:
// backend/src/lib/cast-swap-prism-reference-audio.ts).

import { CAST_SWAP_RESOLUTIONS_BY_ENGINE } from "@nodaro/shared/models"
import type { CastSwapPrismReferenceAudioByResolution, CastSwapPrismReferenceAudioId, TrendEngineEnvironment, TrendResolution } from "@/lib/api"
import { SHARED_SETTING_ENVIRONMENTS } from "./clip-preparation"

/** The resolutions a Prism run renders, in the order the screens show them (its 480p draft first). */
export const PRISM_RESOLUTIONS: readonly TrendResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE["seedance-2-5"]

export const PRISM_REFERENCE_AUDIO_MODES: readonly CastSwapPrismReferenceAudioId[] = ["full", "voice", "none", "one-tone", "octave"]

/**
 * The modes an engine takes only when it lists them in
 * `castSwap.prismReferenceAudioModes` (the server's
 * `DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES`): offered only where it does.
 */
export const DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES: readonly CastSwapPrismReferenceAudioId[] = ["one-tone", "octave"]

/** Whether an environment's engine lists `mode` (the declared-only modes; every other mode is every engine's). */
function envTakes(env: TrendEngineEnvironment | undefined, mode: CastSwapPrismReferenceAudioId): boolean {
  return (env?.supports.castSwap?.prismReferenceAudioModes ?? []).includes(mode)
}

/** A trend's editor: the declared-only modes some environment's engine lists (unknown while the environments are: none). */
export function prismReferenceAudioModesSomeEngineTakes(envs: readonly TrendEngineEnvironment[] | undefined): CastSwapPrismReferenceAudioId[] {
  return DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES.filter((m) => (envs ?? []).some((e) => envTakes(e, m)))
}

/**
 * Admin → Nodaro Motion: the declared-only modes every environment's engine
 * lists (of `SHARED_SETTING_ENVIRONMENTS`; the setting is shared, and the
 * server refuses the save otherwise: 409 `engine_unsupported`). Unknown
 * while the environments are: none.
 */
export function prismReferenceAudioModesEveryEngineTakes(envs: readonly TrendEngineEnvironment[] | undefined): CastSwapPrismReferenceAudioId[] {
  if (!envs) return []
  return DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES.filter((m) => SHARED_SETTING_ENVIRONMENTS.every((name) => envTakes(envs.find((e) => e.env === name), m)))
}

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

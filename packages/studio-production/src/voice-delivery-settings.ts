import { getFactoryPresets, type FactoryPreset } from "@nodaro/prompts"

/**
 * Per-voiceover delivery levers — the `text-to-speech` route's tuning fields
 * (camelCase, verified against the platform Zod: `stability` /
 * `similarityBoost` / `style` 0–1, `speed` 0.7–1.2 — see
 * {@link VOICE_DELIVERY_BOUNDS}, the ONE place those numbers live). The route
 * has no `presetId`; presets are applied CLIENT-side by seeding these levers
 * from `@nodaro/prompts`' factory presets, then sending the explicit values.
 *
 * Prune-to-defaults is the wire contract (mirrors `recast.ts`): an untouched
 * popover yields `undefined`, the request carries no tuning keys, and legacy
 * behavior stays byte-identical.
 */

export interface VoiceDeliverySettings {
  /** Speaking speed — {@link VOICE_DELIVERY_BOUNDS.speed} (route-clamped). */
  readonly speed?: number
  /** Higher = steadier, lower = more expressive / tag-responsive — {@link VOICE_DELIVERY_BOUNDS.stability}. */
  readonly stability?: number
  /** How closely output hugs the voice's timbre — {@link VOICE_DELIVERY_BOUNDS.similarityBoost}. */
  readonly similarityBoost?: number
  /** Style exaggeration. Default 0; >0 amplifies delivery — {@link VOICE_DELIVERY_BOUNDS.style}. */
  readonly style?: number
}

/** ElevenLabs' own defaults — the "untouched" baseline the popover renders. */
export const VOICE_DELIVERY_DEFAULTS: Required<VoiceDeliverySettings> = {
  speed: 1,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
}

/**
 * The four levers, in the order every surface renders them. EXPORTED (as
 * {@link VOICE_DELIVERY_LEVERS}) so the popover's sliders and the importer's
 * clamp receipts iterate the SAME list rather than each naming the four by
 * hand — the same discipline `VOICE_DELIVERY_BOUNDS` already keeps for the
 * numbers.
 */
export const VOICE_DELIVERY_LEVERS = [
  "speed",
  "stability",
  "similarityBoost",
  "style",
] as const

const LEVERS = VOICE_DELIVERY_LEVERS

/**
 * The route's own per-lever ranges (plan-import-v2 D4) — hoisted out of prose
 * comments into ONE place, so the legend (`production-format/legend.ts`), the
 * strict `delivery` node (`production-format/json-schema.ts`) and repair
 * (`production-format/import-repair.ts`, via {@link readDeliverySettings})
 * all read the SAME numbers rather than four hand-typed copies drifting apart.
 */
export const VOICE_DELIVERY_BOUNDS: Readonly<
  Record<(typeof LEVERS)[number], { readonly min: number; readonly max: number }>
> = {
  speed: { min: 0.7, max: 1.2 },
  stability: { min: 0, max: 1 },
  similarityBoost: { min: 0, max: 1 },
  style: { min: 0, max: 1 },
}

/**
 * Drop every lever sitting at its default; `undefined` when nothing is tuned
 * so an untouched voiceover sends no tuning keys at all.
 */
export function pruneDeliverySettings(
  settings: VoiceDeliverySettings | undefined,
): VoiceDeliverySettings | undefined {
  if (!settings) return undefined
  const pruned: Record<string, number> = {}
  for (const lever of LEVERS) {
    const value = settings[lever]
    if (value !== undefined && value !== VOICE_DELIVERY_DEFAULTS[lever]) {
      pruned[lever] = value
    }
  }
  return Object.keys(pruned).length > 0 ? (pruned as VoiceDeliverySettings) : undefined
}

/**
 * Narrow a persisted/unknown blob → pruned {@link VoiceDeliverySettings}, or
 * undefined when nothing usable survives. Only the four known levers are
 * copied (numbers only), each CLAMPED to {@link VOICE_DELIVERY_BOUNDS} — the
 * one clamp this format has (plan-import-v2 D4): the import repair step
 * reuses this reader for `scenes[].voice.delivery` rather than writing a
 * second one, so a corrupt or out-of-range value is narrowed identically
 * whether it arrives via the shot-graph hydrate (`readVoice`, `readRecipe`)
 * or an imported plan document.
 */
export function readDeliverySettings(
  value: unknown,
): VoiceDeliverySettings | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const picked: Record<string, number> = {}
  for (const lever of LEVERS) {
    const v = record[lever]
    if (typeof v !== "number" || !Number.isFinite(v)) continue
    const { min, max } = VOICE_DELIVERY_BOUNDS[lever]
    picked[lever] = Math.min(max, Math.max(min, v))
  }
  return pruneDeliverySettings(picked as VoiceDeliverySettings)
}

export interface VoiceDeliveryPreset {
  readonly id: string
  readonly name: string
  readonly description?: string
  /** Section label ("Narration", "Advertising & Hype", …). */
  readonly group?: string
  readonly settings: VoiceDeliverySettings
}

/** Narrow a factory preset's freeform `data` to the four route levers. */
function presetSettings(data: FactoryPreset["data"]): VoiceDeliverySettings {
  const out: Record<string, number> = {}
  for (const lever of LEVERS) {
    const value = data[lever]
    if (typeof value === "number") out[lever] = value
  }
  return out as VoiceDeliverySettings
}

/**
 * The delivery presets offered in the voiceover tune popover — derived from
 * the platform's `text-to-speech` factory presets (`@nodaro/prompts`), never a
 * hand-copied table. Presets whose data carries none of the levers are
 * dropped (nothing to apply).
 */
export function voiceDeliveryPresets(): ReadonlyArray<VoiceDeliveryPreset> {
  return getFactoryPresets("text-to-speech")
    .map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      ...(p.group ? { group: p.group } : {}),
      settings: presetSettings(p.data),
    }))
    .filter((p) => Object.keys(p.settings).length > 0)
}

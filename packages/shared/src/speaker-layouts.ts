/**
 * Speaker-view presentation registries — the STRUCTURAL vocabulary behind an
 * EDL segment's `layout` (see `EdlLayout` in `edl.ts`).
 *
 * What lives here is structure only: which layout ids exist, how many slots
 * each takes, which output aspects a renderer exists for, which speaker-switch
 * ids exist and whether they consume output time, and the atomic emphasis
 * styles. Taste — default emphasis, which transitions are allowed or preferred
 * for a show, timing defaults — is deliberately NOT here.
 *
 * Every list is widened ADDITIVELY. That is why a finding judged against one of
 * these registries is a validation WARNING, never an issue: an older validator
 * must never reject an EDL written by a newer producer that knows more ids.
 * An executor that cannot honour an id refuses it itself.
 */
import type { Edl } from "./edl.js"
import { COMBINE_TRANSITIONS } from "./combine-transitions.js"
import { resolveEdlSegmentSlots } from "./edl-multicam.js"

export const EDL_TARGET_ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const
export type EdlTargetAspect = (typeof EDL_TARGET_ASPECTS)[number]

const TARGET_ASPECT_SET: ReadonlySet<string> = new Set(EDL_TARGET_ASPECTS)

/** Narrow an open `Edl.meta.targetAspect` (or any value) to a known aspect. */
export function isEdlTargetAspect(v: unknown): v is EdlTargetAspect {
  return typeof v === "string" && TARGET_ASPECT_SET.has(v)
}

// ─────────────────────────────────────────────────────────────────────────
//  Layouts
// ─────────────────────────────────────────────────────────────────────────

export interface SpeakerLayoutSheet {
  readonly id: string
  /** Inclusive slot-count range when a segment lists `layout.slots`. */
  readonly minSlots: number
  readonly maxSlots: number
  /** The output aspects this layout is DRAWN for (a renderer exists) — not "looks good". Widened additively. */
  readonly aspects: readonly EdlTargetAspect[]
}

export const SPEAKER_LAYOUTS: readonly SpeakerLayoutSheet[] = [
  { id: "single", minSlots: 1, maxSlots: 1, aspects: EDL_TARGET_ASPECTS },
  { id: "side-by-side", minSlots: 2, maxSlots: 2, aspects: ["16:9", "1:1"] },
  { id: "stacked", minSlots: 2, maxSlots: 2, aspects: ["9:16", "4:5", "1:1"] },
  { id: "grid", minSlots: 2, maxSlots: 6, aspects: EDL_TARGET_ASPECTS },
  { id: "pip", minSlots: 2, maxSlots: 2, aspects: EDL_TARGET_ASPECTS },
]

export const SPEAKER_LAYOUT_IDS: readonly string[] = SPEAKER_LAYOUTS.map((l) => l.id)

const LAYOUTS_BY_ID: ReadonlyMap<string, SpeakerLayoutSheet> = new Map(SPEAKER_LAYOUTS.map((l) => [l.id, l]))

export function getSpeakerLayout(id: string): SpeakerLayoutSheet | undefined {
  return LAYOUTS_BY_ID.get(id)
}

/** Omitted query fields are unconstrained. */
export function speakerLayoutAllows(
  sheet: SpeakerLayoutSheet,
  q: { readonly aspect?: EdlTargetAspect; readonly slotCount?: number },
): boolean {
  if (q.aspect !== undefined && !sheet.aspects.includes(q.aspect)) return false
  if (q.slotCount !== undefined && !(q.slotCount >= sheet.minSlots && q.slotCount <= sheet.maxSlots)) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────
//  Speaker switches (EdlLayout.transition.type)
// ─────────────────────────────────────────────────────────────────────────

/** The one prefix of the time-consuming (cross-source blend) switch family. */
const XFADE_SWITCH_PREFIX = "xfade:"

/** D17: a switch consumes output time iff it is in the `xfade:*` family. THE one overlap rule (edl.ts uses it). */
export function speakerSwitchOverlaps(type: string): boolean {
  return typeof type === "string" && type.startsWith(XFADE_SWITCH_PREFIX)
}

export interface SpeakerSwitchSheet {
  /** "cut" | "pan" | "zoom" | `xfade:${combine id}` */
  readonly id: string
  /** = `speakerSwitchOverlaps(id)`, derived, never hand-set. */
  readonly overlaps: boolean
  /** true only for `pan`: an eased sweep between two regions of ONE picture source. */
  readonly requiresSameSource: boolean
}

const switchSheet = (id: string, requiresSameSource: boolean): SpeakerSwitchSheet => ({
  id,
  overlaps: speakerSwitchOverlaps(id),
  requiresSameSource,
})

/** `cut` / `pan` / `zoom` consume no time (pan: a geometry tween inside ONE
 *  source; zoom: a tween inside each segment). The `xfade:*` family is DERIVED
 *  from every combine-videos transition that is a real ffmpeg xfade (so never
 *  `cut`, which has no xfade) — it is never hand-listed here. */
export const SPEAKER_SWITCHES: readonly SpeakerSwitchSheet[] = [
  switchSheet("cut", false),
  switchSheet("pan", true),
  switchSheet("zoom", false),
  ...COMBINE_TRANSITIONS.filter((t) => t.xfade !== null).map((t) => switchSheet(XFADE_SWITCH_PREFIX + t.id, false)),
]

export const SPEAKER_SWITCH_IDS: readonly string[] = SPEAKER_SWITCHES.map((s) => s.id)

const SWITCHES_BY_ID: ReadonlyMap<string, SpeakerSwitchSheet> = new Map(SPEAKER_SWITCHES.map((s) => [s.id, s]))

/** A plain lookup: `undefined` for an unknown id (never throws). */
export function getSpeakerSwitch(id: string): SpeakerSwitchSheet | undefined {
  return SWITCHES_BY_ID.get(id)
}

// ─────────────────────────────────────────────────────────────────────────
//  Emphasis (EdlLayout.emphasis.style)
// ─────────────────────────────────────────────────────────────────────────

/** Atomic emphasis styles; `layout.emphasis.style` is a "+"-joined set of
 *  them. `none` stands alone (it means "no emphasis"), and an atom appears at
 *  most once. */
export const SPEAKER_EMPHASIS_STYLES = ["none", "scale", "border", "dim"] as const
export type SpeakerEmphasisStyle = (typeof SPEAKER_EMPHASIS_STYLES)[number]

const EMPHASIS_STYLE_SET: ReadonlySet<string> = new Set(SPEAKER_EMPHASIS_STYLES)

/** Split a `+`-joined style into its atoms: trimmed, empties dropped. */
export function parseSpeakerEmphasisStyle(style: string): readonly string[] {
  if (typeof style !== "string") return []
  return style
    .split("+")
    .map((atom) => atom.trim())
    .filter((atom) => atom.length > 0)
}

/** At least one atom, every atom a known `SPEAKER_EMPHASIS_STYLES` id, no
 *  atom repeated, and `none` only on its own ("none+scale" contradicts itself). */
export function isKnownSpeakerEmphasisStyle(style: string): boolean {
  const atoms = parseSpeakerEmphasisStyle(style)
  if (atoms.length === 0 || !atoms.every((atom) => EMPHASIS_STYLE_SET.has(atom))) return false
  if (new Set(atoms).size !== atoms.length) return false
  return !(atoms.includes("none") && atoms.length > 1)
}

// ─────────────────────────────────────────────────────────────────────────
//  Registry-derived findings
// ─────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object"

/** Registry-derived findings — ALL warning-class. Pure; never throws (guard non-array sources/segments the
 *  way validateEdl does). `validateEdl` already includes these in its `warnings`; call this directly only
 *  when you want the presentation findings alone. */
export function speakerPresentationWarnings(edl: Edl): readonly string[] {
  const warnings: string[] = []
  if (!isObject(edl)) return warnings
  // Guard a raw object that skipped normalizeEdl, exactly as validateEdl does.
  const safe: Edl = {
    ...edl,
    sources: Array.isArray(edl.sources) ? edl.sources : [],
    segments: Array.isArray(edl.segments) ? edl.segments : [],
  }

  const rawAspect = isObject(safe.meta) ? safe.meta.targetAspect : undefined
  const aspect = isEdlTargetAspect(rawAspect) ? rawAspect : undefined
  if (rawAspect != null && aspect === undefined) {
    warnings.push(`meta.targetAspect "${String(rawAspect)}" is not a known target aspect (known: ${EDL_TARGET_ASPECTS.join(", ")})`)
  }

  safe.segments.forEach((seg, i) => {
    if (!isObject(seg) || !isObject(seg.layout)) return
    const at = `segment[${i}] "${seg.id}"`
    const layout = seg.layout

    // 1. The layout mode, its slot count, and the output aspect.
    const sheet = typeof layout.mode === "string" ? getSpeakerLayout(layout.mode) : undefined
    if (!sheet) {
      warnings.push(`${at}: unknown layout mode "${String(layout.mode)}" (known: ${SPEAKER_LAYOUT_IDS.join(", ")})`)
    } else {
      const slotCount = Array.isArray(layout.slots) ? layout.slots.length : 0
      if (slotCount > 0 && !speakerLayoutAllows(sheet, { slotCount })) {
        const range = sheet.minSlots === sheet.maxSlots ? `${sheet.minSlots}` : `${sheet.minSlots}–${sheet.maxSlots}`
        warnings.push(`${at}: layout "${sheet.id}" takes ${range} slot(s), got ${slotCount}`)
      }
      if (aspect !== undefined && !speakerLayoutAllows(sheet, { aspect })) {
        warnings.push(`${at}: layout "${sheet.id}" is not drawn for targetAspect ${aspect} (drawn for: ${sheet.aspects.join(", ")})`)
      }
    }

    // 2. The switch into this segment.
    if (isObject(layout.transition)) {
      const type = layout.transition.type
      const sw = typeof type === "string" ? getSpeakerSwitch(type) : undefined
      if (!sw) {
        warnings.push(`${at}: unknown layout transition "${String(type)}" (known: ${SPEAKER_SWITCHES.filter((s) => !s.overlaps).map((s) => s.id).join(", ")}, or ${XFADE_SWITCH_PREFIX}<id> for a combine-videos transition that is a real ffmpeg xfade — never ${XFADE_SWITCH_PREFIX}cut)`)
      } else if (sw.requiresSameSource && i > 0) {
        // Only a one-picture → one-picture boundary has a defined "picture
        // source"; any other shape (multi-slot, no video) is not judged here.
        const prev = safe.segments[i - 1]
        const cur = resolveEdlSegmentSlots(safe, seg)
        const before = isObject(prev) ? resolveEdlSegmentSlots(safe, prev) : []
        if (cur.length === 1 && before.length === 1 && cur[0].source !== before[0].source) {
          warnings.push(`${at}: switch "${sw.id}" moves within ONE picture source, but the previous segment shows "${before[0].source}" and this one "${cur[0].source}"`)
        }
      }
    }

    // 3. The emphasis style.
    if (isObject(layout.emphasis) && !isKnownSpeakerEmphasisStyle(layout.emphasis.style as string)) {
      const style = String(layout.emphasis.style)
      const atoms = parseSpeakerEmphasisStyle(layout.emphasis.style as string)
      warnings.push(atoms.length > 0 && atoms.every((a) => EMPHASIS_STYLE_SET.has(a))
        ? `${at}: emphasis style "${style}" — "none" must stand alone and no style may repeat`
        : `${at}: unknown emphasis style "${style}" (a "+"-joined set of: ${SPEAKER_EMPHASIS_STYLES.join(", ")})`)
    }
  })

  return warnings
}

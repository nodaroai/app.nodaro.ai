/**
 * What a Speaker View node may be set to (SV2, SV3, SV4, SV10, SV20, SV23):
 * the applicability matrix as ONE set of pure functions. The config panel
 * greys what they rule out and names why, the quick strip lists only what they
 * allow, and the normalizer snaps a stored value they rule out — all three
 * read these, so they can never disagree.
 *
 * `ctx` is the edit wired in (`speakerViewContext`). Without it only the rules
 * the aspect alone decides apply (U2b: "No EDL wired").
 */
import { getSpeakerLayout, isKnownSpeakerEmphasisStyle, speakerLayoutAllows, type EdlTargetAspect } from "@nodaro/shared"
import { snapLayout } from "./speaker-view-layout.js"
import type { SpeakerViewContext } from "./speaker-view-context.js"
import { isSpeakerViewSwitchDrawn, SPEAKER_VIEW_MAX_TWEEN_MS } from "./speaker-view-settings-check.js"
import {
  MULTI_SLOT_LAYOUTS,
  SPEAKER_VIEW_ACCENT_PATTERN,
  SPEAKER_VIEW_DEFAULTS,
  SPEAKER_VIEW_DEFAULT_ASPECT,
  SPEAKER_VIEW_EMPHASIS_ATOMS,
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  isSpeakerViewAspect,
} from "./speaker-view-settings.js"

/** The node's settings as its data carries them (flat). */
export interface SpeakerViewNodeSettings {
  readonly targetAspect?: unknown
  readonly layout?: unknown
  readonly switchType?: unknown
  readonly switchDurationMs?: unknown
  readonly emphasisStyle?: unknown
  readonly emphasisDurationMs?: unknown
  readonly accentColor?: unknown
  readonly speakerRegions?: unknown
  readonly quality?: unknown
}

/**
 * Why a choice is ruled out, as a code and its numbers. The panel turns it into
 * a localized sentence; the rule never ships English for the UI.
 *  - aspect-not-drawn: the layout has no renderer at this aspect.
 *  - too-few-speakers / too-many-speakers: the edit's speaker count (of clip
 *    `clip` in a pack) is outside the layout's slot range.
 *  - single-shows-one: emphasis marks one speaker among several.
 *  - swap-is-emphasis: in PiP the swap itself is the Scale emphasis.
 *  - slots-fixed: a fixed multi-slot layout keeps its slots, so Pan / Zoom
 *    have nothing to move.
 *  - no-same-camera-change: no speaker change stays inside one camera.
 */
export type SpeakerViewReasonCode =
  | "aspect-not-drawn"
  | "too-few-speakers"
  | "too-many-speakers"
  | "single-shows-one"
  | "swap-is-emphasis"
  | "slots-fixed"
  | "no-same-camera-change"

export interface SpeakerViewReason {
  readonly code: SpeakerViewReasonCode
  readonly params: Readonly<Record<string, string | number>>
}

export interface SpeakerViewOption {
  readonly id: string
  readonly allowed: boolean
  readonly reason?: SpeakerViewReason
}

const allowed = (id: string): SpeakerViewOption => ({ id, allowed: true })
const ruledOut = (id: string, code: SpeakerViewReasonCode, params: SpeakerViewReason["params"] = {}): SpeakerViewOption => ({ id, allowed: false, reason: { code, params } })

/** The aspect a node is drawn at: its own, else the edit's, else 16:9. */
export function speakerViewAspectOf(data: SpeakerViewNodeSettings, ctx?: SpeakerViewContext): EdlTargetAspect {
  if (isSpeakerViewAspect(data.targetAspect)) return data.targetAspect
  return ctx?.targetAspect ?? SPEAKER_VIEW_DEFAULT_ASPECT
}

const layoutOf = (data: SpeakerViewNodeSettings): string =>
  typeof data.layout === "string" && SPEAKER_VIEW_LAYOUT_SETTINGS.includes(data.layout) ? data.layout : "auto"

/** Every layout setting with whether it suits the aspect and — when the edit is
 *  known — every clip's speaker count (SV3, SV23). `auto` and `single` always do. */
export function validSpeakerLayouts(data: SpeakerViewNodeSettings, ctx?: SpeakerViewContext): SpeakerViewOption[] {
  const aspect = speakerViewAspectOf(data, ctx)
  return SPEAKER_VIEW_LAYOUT_SETTINGS.map((id) => {
    const sheet = getSpeakerLayout(id)
    if (id === "auto" || !sheet || id === "single") return allowed(id)
    if (!speakerLayoutAllows(sheet, { aspect })) return ruledOut(id, "aspect-not-drawn", { layout: id, aspect })
    const clips = ctx?.clips ?? []
    for (const [i, clip] of clips.entries()) {
      const where: Record<string, number> = clips.length > 1 ? { clip: i + 1 } : {}
      if (clip.speakerCount > sheet.maxSlots) return ruledOut(id, "too-many-speakers", { layout: id, max: sheet.maxSlots, count: clip.speakerCount, ...where })
      if (clip.speakerCount < sheet.minSlots) return ruledOut(id, "too-few-speakers", { layout: id, min: sheet.minSlots, count: clip.speakerCount, ...where })
    }
    return allowed(id)
  })
}

/** The switch ids a picker offers, in order: cut, pan, zoom. The crossfade
 *  family is offered whole (`xfade:*`, SV21 c: the plugin draws it only where
 *  the master clock jumps); this lists the three it cannot summarise. */
export const SPEAKER_VIEW_BASIC_SWITCHES = ["cut", "pan", "zoom"] as const

/** The three basic switches with whether they apply to this layout and edit
 *  (SV2, SV5): a fixed multi-slot layout keeps its slots, so Pan and Zoom are
 *  ruled out; Pan is ruled out when NO speaker change stays inside one camera. */
export function validSpeakerSwitches(data: SpeakerViewNodeSettings, ctx?: SpeakerViewContext): SpeakerViewOption[] {
  const layout = layoutOf(data)
  const fixed = MULTI_SLOT_LAYOUTS.has(layout)
  return SPEAKER_VIEW_BASIC_SWITCHES.map((id) => {
    if (id === "cut") return allowed(id)
    if (fixed) return ruledOut(id, "slots-fixed", { layout })
    if (id === "pan" && ctx && ctx.clips.every((c) => c.changesKnown && c.changes > 0 && c.sameCameraChanges === 0)) {
      return ruledOut(id, "no-same-camera-change", { changes: ctx.clips.reduce((n, c) => n + c.changes, 0) })
    }
    return allowed(id)
  })
}

/** The emphasis atoms with whether they apply (SV2): Single shows one speaker,
 *  so none do; in PiP the swap is the scale. */
export function validSpeakerEmphasis(data: SpeakerViewNodeSettings): SpeakerViewOption[] {
  const layout = layoutOf(data)
  return SPEAKER_VIEW_EMPHASIS_ATOMS.map((id) => {
    if (layout === "single") return ruledOut(id, "single-shows-one")
    if (layout === "pip" && id === "scale") return ruledOut(id, "swap-is-emphasis")
    return allowed(id)
  })
}

/** What the normalizer changed, for the panel's and badge's "renders as …" line. */
export interface SpeakerViewNormalizeNote {
  readonly code: "layout-snapped"
  readonly from: string
  readonly to: string
  readonly aspect: EdlTargetAspect
  /** Why it snapped: the layout has no renderer at this aspect, or the edit's
   *  speaker count is outside its slot range. */
  readonly because: "aspect" | "speakers"
}

const tween = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(SPEAKER_VIEW_MAX_TWEEN_MS, Math.max(0, Math.round(v))) : undefined

/**
 * Coerces a node's settings to ones the renderer draws (SV4 a, pitfall 5b): an
 * unknown or malformed value is replaced by its default or dropped, and a
 * layout the aspect or the speaker count rules out becomes its twin (side by
 * side ↔ stacked), else grid if the count fits, else single. It never rejects.
 * Settings the MATRIX rules out for the chosen layout (a Pan under Grid) are
 * left as the person set them — the renderer ignores them, and a later change
 * of layout brings them back.
 *
 * With `ctx` (the real EDL, or one clip of a pack) the count is exact; without
 * it (an MCP write, a template) only the aspect is judged, and only when the
 * node names one: with neither, the layout is left alone for the run to judge.
 */
export function normalizeSpeakerViewData<T extends SpeakerViewNodeSettings>(
  data: T,
  ctx?: SpeakerViewContext,
): { readonly data: T; readonly notes: readonly SpeakerViewNormalizeNote[] } {
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  const notes: SpeakerViewNormalizeNote[] = []
  const drop = (key: string) => { delete out[key] }

  if (data.targetAspect !== undefined && !isSpeakerViewAspect(data.targetAspect)) drop("targetAspect")
  if (data.layout !== undefined && !(typeof data.layout === "string" && SPEAKER_VIEW_LAYOUT_SETTINGS.includes(data.layout))) out.layout = "auto"
  if (data.switchType !== undefined && !isSpeakerViewSwitchDrawn(data.switchType)) out.switchType = "cut"
  if (data.emphasisStyle !== undefined && !(typeof data.emphasisStyle === "string" && isKnownSpeakerEmphasisStyle(data.emphasisStyle))) out.emphasisStyle = "none"
  for (const key of ["switchDurationMs", "emphasisDurationMs"] as const) {
    if (data[key] === undefined) continue
    const ms = tween(data[key])
    if (ms === undefined) drop(key)
    else out[key] = ms
  }
  if (data.accentColor !== undefined && !(typeof data.accentColor === "string" && SPEAKER_VIEW_ACCENT_PATTERN.test(data.accentColor))) drop("accentColor")

  const layout = out.layout
  // With neither the edit nor an aspect of its own, the aspect is UNKNOWN, and
  // the 16:9 fallback is only the renderer's last resort, not a fact about this
  // node: a Stacked layout written for a 9:16 edit would be rewritten for an
  // aspect it never had. Leave the layout to the payload builder, which judges
  // it against the real edit.
  const aspectKnown = ctx !== undefined || isSpeakerViewAspect(out.targetAspect)
  if (aspectKnown && typeof layout === "string" && (MULTI_SLOT_LAYOUTS.has(layout) || layout === "pip")) {
    const aspect = speakerViewAspectOf(out, ctx)
    const sheet = getSpeakerLayout(layout as string)!
    // Without the edit, assume the count the layout itself takes.
    const counts = ctx ? ctx.clips.map((c) => c.speakerCount) : [sheet.minSlots]
    // A pack whose clips would snap differently falls back to single.
    const snaps = new Set(counts.map((n) => snapLayout(layout as string, aspect, n)))
    const snapped = snaps.size === 1 ? [...snaps][0]! : "single"
    if (snapped !== layout) {
      out.layout = snapped
      notes.push({ code: "layout-snapped", from: layout as string, to: snapped, aspect, because: speakerLayoutAllows(sheet, { aspect }) ? "speakers" : "aspect" })
    }
  }
  return { data: out as T, notes }
}

/** SV20's defaults for a node that has never been set, from the topology of the
 *  edit first wired in: one video source → Single + Pan; two or more → Auto +
 *  Cut; emphasis Scale 300 ms; the aspect the edit names, else 16:9. */
export function speakerViewDefaultsFor(ctx: SpeakerViewContext): Required<Pick<SpeakerViewNodeSettings, "layout" | "switchType" | "switchDurationMs" | "emphasisStyle" | "emphasisDurationMs" | "targetAspect">> {
  const oneCamera = ctx.clips.every((c) => c.cameras <= 1)
  return {
    layout: oneCamera ? "single" : "auto",
    switchType: oneCamera ? "pan" : "cut",
    switchDurationMs: SPEAKER_VIEW_DEFAULTS.switchDurationMs,
    emphasisStyle: SPEAKER_VIEW_DEFAULTS.emphasisStyle,
    emphasisDurationMs: SPEAKER_VIEW_DEFAULTS.emphasisDurationMs,
    targetAspect: ctx.targetAspect ?? SPEAKER_VIEW_DEFAULT_ASPECT,
  }
}

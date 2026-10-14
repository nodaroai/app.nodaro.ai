/**
 * Speaker View's price tier (C4, decided 2026-10-10): a render is priced by how
 * many speakers it composites at once.
 *  - `standard` — at most two tiles on any segment and no zoom: 2 credits per
 *    output minute for a preview, 10 for a final (Apply EDL's own figures);
 *  - `complex` — three to six tiles on some segment, or any zoom: 3 and 12.
 * The rows themselves are `speakerViewCreditId(quality, tier)` (`@nodaro/shared`).
 *
 * WHAT COUNTS. Tiles are counted on the edit AS GIVEN, laid out by the layout
 * stage the plugin runs (`layOutSpeakerView`, this package's mirror, drift-
 * checked against the plugin): the node's layout, Camera Switch's hints, the
 * aspect and speaker-count snaps and the late-camera snap. The plugin's turn
 * split is NOT run: it keeps every piece's tiles, so it can only add speaker
 * changes, never tiles. A zoom counts wherever one could be drawn — on a
 * segment that shows one picture (single) or a main and an inset (pip) — when
 * the node's switch is Zoom, or the segment carries a zoom of its own. Whether
 * a speaker change lands there is not asked: the price is decided before the
 * split names the changes, so it leans high, as every reserve here does.
 *
 * The cloud plugin's route prices with its own copy of this rule; the
 * cross-repo fixture (`backend/src/lib/__tests__/fixtures/speaker-view-
 * pricing-cases.json`) holds the two to the same answer on every case.
 *
 * Pure; never mutates its input.
 */
import {
  EDL_TARGET_ASPECTS,
  SPEAKER_LAYOUTS,
  editPlanSavedOutput,
  transcriptSpeakerLabels,
  type Edl,
  type EdlSegment,
  type EdlTargetAspect,
} from "@nodaro/shared/edl"
import type {
  SpeakerViewPriceTier,
} from "@nodaro/shared/credits"
import { coerceSpeakerViewEdl, resolveSpeakerViewAspect } from "./speaker-view-rule.js"
import { layOutSpeakerView, snapLayout, speakerOrder, speakerViewSlotSet } from "./speaker-view-layout.js"
import { speakerViewContext } from "./speaker-view-context.js"
import { normalizeSpeakerViewData, type SpeakerViewNodeSettings } from "./speaker-view-options.js"
import { isSpeakerViewAspect } from "./speaker-view-settings.js"
import { speakerViewWireSettings, type SpeakerViewWireSettings } from "./speaker-view-wire.js"
import {
  persistedEdlPlan,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate.js"

/** The fewest tiles on one segment that make a render `complex`. */
export const SPEAKER_VIEW_COMPLEX_MIN_TILES = 3

const transcriptGiven = (raw: unknown) => raw !== undefined && raw !== null && raw !== ""

/** How many pictures a laid-out segment composites: its slots under a
 *  multi-slot or pip layout, else one. */
export function speakerViewSegmentTiles(seg: EdlSegment): number {
  const layout = seg.layout
  const slots = Array.isArray(layout?.slots) ? layout!.slots!.length : 0
  return layout && layout.mode !== "single" && slots >= 2 ? slots : 1
}

/** Can a zoom be drawn on this laid-out segment? Only where one picture is
 *  re-framed: single, or pip's main picture. */
function zoomDrawable(seg: EdlSegment): boolean {
  const mode = seg.layout?.mode
  return speakerViewSegmentTiles(seg) === 1 || mode === "pip"
}

export interface SpeakerViewPriceTierInput {
  /** One edit, as given: an object or its JSON string. */
  readonly edl: unknown
  /** The wired transcript (its speaker labels fill the tiles of an edit that names none). */
  readonly transcript?: unknown
  /** The route's settings (`speakerViewWireSettings`). */
  readonly settings?: SpeakerViewWireSettings
}

/** What the tier was decided from, for the docs and the tests. */
export interface SpeakerViewPriceBasis {
  readonly tier: SpeakerViewPriceTier
  /** The most tiles any segment composites (0 when the edit cannot be read). */
  readonly maxTiles: number
  readonly zoom: boolean
}

/**
 * The price tier of ONE render of `edl` with these settings — the tier the
 * route and the workflow run both reserve in. An edit that cannot be read is
 * `complex` (it is refused before any reserve anyway; an unknown leans high).
 */
export function speakerViewPriceBasis(input: SpeakerViewPriceTierInput): SpeakerViewPriceBasis {
  const coerced = coerceSpeakerViewEdl(input.edl)
  if ("problem" in coerced) return { tier: "complex", maxTiles: 0, zoom: false }
  const edl: Edl = coerced.edl
  const settings = input.settings ?? {}
  const labels = transcriptGiven(input.transcript) ? transcriptSpeakerLabels(input.transcript) : []
  const laid = layOutSpeakerView(edl, {
    aspect: resolveSpeakerViewAspect(settings.targetAspect, edl),
    ...(typeof settings.layout === "string" ? { layout: settings.layout } : {}),
    speakers: speakerViewSlotSet(edl, labels),
  })
  const nodeZoom = settings.switch?.type === "zoom"
  let maxTiles = 0
  let zoom = false
  for (const seg of laid.drawn.segments) {
    maxTiles = Math.max(maxTiles, speakerViewSegmentTiles(seg))
    if (zoomDrawable(seg) && (nodeZoom || seg.layout?.transition?.type === "zoom")) zoom = true
  }
  return { tier: zoom || maxTiles >= SPEAKER_VIEW_COMPLEX_MIN_TILES ? "complex" : "standard", maxTiles, zoom }
}

/** {@link speakerViewPriceBasis}'s tier. */
export function speakerViewPriceTier(input: SpeakerViewPriceTierInput): SpeakerViewPriceTier {
  return speakerViewPriceBasis(input).tier
}

/** The most speakers any layout seats. */
const MOST_SLOTS = Math.max(...SPEAKER_LAYOUTS.map((l) => l.maxSlots))

/**
 * The most tiles a layout setting can composite over an edit not seen yet:
 * every speaker count, snapped the way the run snaps it (`snapLayout` — Side
 * by side, Stacked and Picture-in-picture take two speakers and become a Grid
 * at three or more), at the node's aspect, or at every aspect when it names
 * none. Auto follows the edit's own hints, so it is unbounded. Derived from
 * the layout sheets, never a hand list, so a new layout or a widened slot
 * range is priced right by default.
 */
function settingsMaxTiles(layout: string, aspect: EdlTargetAspect | undefined): number {
  if (layout === "auto") return Number.POSITIVE_INFINITY
  let most = 1
  for (const a of aspect ? [aspect] : EDL_TARGET_ASPECTS) {
    for (let n = 2; n <= MOST_SLOTS; n++) if (snapLayout(layout, a, n) !== "single") most = Math.max(most, n)
  }
  return most
}

/**
 * The tier from the node's settings alone, when the edit is not known yet. The
 * speaker count is unknown then, so a layout is `standard` only when no count
 * can give it three tiles — in practice Single — and the switch is not Zoom;
 * everything else is `complex`: the estimate never quotes under the run.
 */
export function speakerViewSettingsTier(data: SpeakerViewNodeSettings): SpeakerViewPriceTier {
  const d = normalizeSpeakerViewData(data).data
  const layout = typeof d.layout === "string" ? d.layout : "auto"
  const aspect = isSpeakerViewAspect(d.targetAspect) ? d.targetAspect : undefined
  return settingsMaxTiles(layout, aspect) < SPEAKER_VIEW_COMPLEX_MIN_TILES && d.switchType !== "zoom" ? "standard" : "complex"
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/**
 * The tier an ESTIMATE quotes for a node with these settings over the edits
 * it will render (one edit, or a clip batch: the dearest clip). `edls`
 * undefined = the edit is not known: the settings decide
 * ({@link speakerViewSettingsTier}). An edit that names no speaker with no
 * transcript known (one that is wired, not typed in, is not read here) cannot
 * say how many speakers fill the tiles: any layout the settings alone cannot
 * call `standard` is `complex`; under Single the edit is still read, for a
 * zoom of its own.
 */
export function speakerViewEstimateTier(data: SpeakerViewNodeSettings, edls?: unknown, transcript?: unknown): SpeakerViewPriceTier {
  const parsed = parse(edls)
  const list = parsed === undefined ? [] : (Array.isArray(parsed) ? parsed : [parsed]).map(parse)
  if (list.length === 0) return speakerViewSettingsTier(data)
  for (const edl of list) {
    const coerced = coerceSpeakerViewEdl(edl)
    if ("problem" in coerced) return speakerViewSettingsTier(data)
    if (speakerOrder(coerced.edl).length === 0 && !transcriptGiven(transcript) && speakerViewSettingsTier(data) === "complex") return "complex"
    const settings = speakerViewWireSettings(data, speakerViewContext(coerced.edl, transcript))
    if (speakerViewPriceTier({ edl: coerced.edl, transcript, settings }) === "complex") return "complex"
  }
  return "standard"
}

/**
 * The tier a run estimate (the editor's, the server's listing) quotes for a
 * Speaker View node in its graph: the edit its `edl` wire carries now — read
 * the way the length estimate reads it (`persistedEdlPlan`, through Camera
 * Switch) — or its own inline edit when nothing is wired. A producer about to
 * re-run, or one with nothing saved, leaves the edit unknown: the settings
 * decide. The transcript is the node's inline one only.
 *
 * @param rerunIds ids of the nodes about to execute (an empty set for a
 *   single-node estimate).
 */
export function resolveSpeakerViewEstimateTier(
  /** A node with no id cannot be placed in its graph: its own data decides. */
  node: Omit<EstimateGraphNode, "id"> & { readonly id?: string },
  nodes: readonly EstimateGraphNode[] | undefined,
  edges: readonly EstimateGraphEdge[] | undefined,
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): SpeakerViewPriceTier {
  const data = ((node.data as Record<string, unknown> | undefined) ?? {}) as SpeakerViewNodeSettings & Record<string, unknown>
  const transcript = data.transcript
  if (!edges || !nodes || node.id === undefined) return data.edl !== undefined ? speakerViewEstimateTier(data, data.edl, transcript) : speakerViewSettingsTier(data)
  const edlEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "edl")
  if (edlEdges.length === 0) return data.edl !== undefined ? speakerViewEstimateTier(data, data.edl, transcript) : speakerViewSettingsTier(data)
  for (const edge of edlEdges) {
    const producer = resolveGraphOrigin(nodes.find((n) => n.id === edge.source), nodes, edges)
    if (!producer || rerunIds.has(producer.id)) return speakerViewSettingsTier(data)
    const plan = persistedEdlPlan(producer, planOutputOf)
    if (plan === undefined || plan === null) return speakerViewSettingsTier(data)
    if (speakerViewEstimateTier(data, plan, transcript) === "complex") return "complex"
  }
  return "standard"
}

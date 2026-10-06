/**
 * The Clip Pack inspector's model (§4.1 of the inspectors design, A4-1): one
 * card per planned clip the render's wire sends it, matched to its takes by
 * `clipKey`. Pure: the caller hands in the canvas values; nothing is fetched.
 *
 *  - Which clips (R12 a, decided 2026-10-06): the rows the wires between the
 *    plan and the render pick, on the PLAN's indices (TA16): every hop's
 *    selector, as `renderPlanValue` applies them. A dropped clip the wires pick
 *    keeps its card, so it can be kept again. `notSent` counts the rest.
 *    Behind Camera Switch the switch runs once per KEPT clip, so the next wire
 *    selects from (and the render is rowed in) the kept clips only. A clip
 *    dropped there keeps its card, with no `renderRow`: the render never reads
 *    it. Cards are in plan order.
 *  - Takes: the newest Preview (`quality: "proxy"`) and the newest Final of the
 *    same `clipKey` in the render's results (newest first).
 *  - `unchanged` (R13 a, R19 a): the final was cut from this clip's plan value
 *    (`planBasis`, which leaves `meta` out, so an edited hook keeps it) AND with
 *    the render's settings as they are now (`renderBasis`). A missing stamp, on
 *    the final or now, counts as changed (it fails open).
 *  - `previewStale`: the preview was cut from another plan value, or with
 *    other settings. An unstamped preview is stale. With the settings unknown
 *    now (a dropped clip has no render row), the plan value alone decides.
 *  - Holes: a row of the latest Preview batch with no take is `preview-failed`
 *    only for a clip kept now. Both engines stamp every hole `{}` — a sent row
 *    that failed and a dropped row the run skipped alike — so the stamp cannot
 *    tell them apart, and a dropped clip's hole reads "no preview yet". With no
 *    row stamps every hole reads "no preview yet", never "failed".
 *    Behind Camera Switch the batch's rows are the switch's own, which shift
 *    with the drops at that run, so a hole there says nothing about a card.
 *  - `orphanFinals`: finals whose clip matches no card, newest per clip — a
 *    clip the plan no longer has, or one the wire no longer sends.
 */
import {
  edlDurationMs,
  normalizeEdl,
  planClipKeyAt,
  renderClipKey,
  renderReadBasis,
  renderResultStamp,
  resolveEditPlanOutput,
  resolveIndex,
  savedRenderBatch,
  selectListItems,
  type EditedClipDecision,
  type EditedClipSet,
  type RenderMedium,
  type RenderPlanHop,
  type RenderQuality,
  type RunResultRowStamp,
  type SavedRenderItem,
  type SelectorFields,
} from "@nodaro/shared"
import type { ApplyEdlRenderInput, ApplyEdlRenderSettings } from "@/lib/edl-validity"
import { renderSettingsBasisOf } from "./staleness"

/** What a card shows on its state line. `preview-stale` is the preview with
 *  its "predates this plan" mark; `audio-only` is an audio render's preview. */
export type ClipCardState =
  | "no-preview"
  | "preview-rendering"
  | "preview-failed"
  | "preview"
  | "preview-stale"
  | "audio-only"
  | "final-rendering"
  | "final-ready"
  | "final-not-in-set"

export interface ClipCard {
  /** The clip's index in the plan. */
  readonly row: number
  /** The row of the render's own list it is cut from; absent for a render run once. */
  readonly renderRow?: number
  readonly clipKey: string
  readonly title?: string
  readonly plannedHook?: string
  /** The hook as it reads now: the person's, else the plan's. */
  readonly hook?: string
  readonly hookEdited: boolean
  readonly keep: boolean
  readonly durationMs: number
  /** The clip's outer span on the master clock. */
  readonly sourceSpan: { readonly inMs: number; readonly outMs: number }
  readonly preview?: SavedRenderItem
  readonly final?: SavedRenderItem
  readonly unchanged: boolean
  readonly previewStale: boolean
  readonly state: ClipCardState
}

/** A run that includes the render, while it is live. */
export interface ClipLiveRun {
  readonly quality: RenderQuality
  /** The clips whose take has landed in this run. */
  readonly landed: ReadonlySet<string>
  readonly done: number
  readonly total: number
}

export interface ClipCardsInput {
  /** The plan as stored (`generatedJson`): a clip set. */
  readonly plan: unknown
  /** The plan's stored review (`editedEdl`). */
  readonly editedEdl: unknown
  /** The not-yet-written decisions, which win over the stored review. */
  readonly decisions?: readonly EditedClipDecision[]
  /** The render node's data. */
  readonly renderData: Readonly<Record<string, unknown>>
  /** The wires from the plan down to the render (`renderPlanPath(...).hops`). */
  readonly hops: readonly RenderPlanHop[]
  /** The settings basis each clip's render would stamp now (`clipRenderBases`). */
  readonly renderBases?: ReadonlyMap<string, string>
  /** The latest batch's row stamps, row-aligned with `__listResults`. */
  readonly rowStamps?: ReadonlyArray<RunResultRowStamp | undefined>
  readonly live?: ClipLiveRun
}

export interface ClipCards {
  readonly cards: readonly ClipCard[]
  /** Clips the plan has that the render's wires do not send it. */
  readonly notSent: number
  readonly orphanFinals: readonly SavedRenderItem[]
  readonly keptCount: number
  readonly keptDurationMs: number
  /** Kept clips whose last final is unchanged (they still re-render and bill). */
  readonly unchangedKept: number
  readonly medium: RenderMedium
  readonly progress?: { readonly done: number; readonly total: number }
}

type Rec = Record<string, unknown>
const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

/** The decisions a clip set's review holds: the applied review's, else every
 *  clip kept as planned (a stale or invalid review is ignored). `null` for a
 *  plan that is not a clip set. */
export function clipDecisionsOf(plan: unknown, editedEdl: unknown): EditedClipDecision[] | null {
  if (!Array.isArray(plan)) return null
  if (resolveEditPlanOutput(plan, editedEdl).status === "applied" && (editedEdl as EditedClipSet).kind === "clips") {
    return (editedEdl as EditedClipSet).clips.map((d) => (d.hook === undefined ? { keep: d.keep } : { keep: d.keep, hook: d.hook }))
  }
  return plan.map(() => ({ keep: true }))
}

/**
 * The settings basis each clip's render would stamp now, keyed by its clip:
 * `renders` are the render's rows (`resolveApplyEdlRenders`), `planOutput` the
 * plan's list as the canvas holds it (a hole at a dropped clip). A row with no
 * EDL (a hole) has none.
 */
export function clipRenderBases(
  renders: readonly ApplyEdlRenderInput[],
  settings: ApplyEdlRenderSettings,
  planOutput: unknown,
  hops: readonly RenderPlanHop[],
): Map<string, string> {
  const bases = new Map<string, string>()
  for (const render of renders) {
    const key = renderClipKey(planOutput, render.row, hops)
    const basis = key ? renderSettingsBasisOf(render, settings) : undefined
    if (key && basis && !bases.has(key)) bases.set(key, basis)
  }
  return bases
}

/** The plan rows a wire that hands on ONE value passes (`singlePick` in
 *  render-output, on indices). "Selected" out of an Edit Plan is its first
 *  KEPT clip. */
function singlePickRows(rows: readonly number[], hop: RenderPlanHop, kept: (row: number) => boolean): number[] {
  const data = hop.edge.data as (SelectorFields & { itemIndex?: unknown; outputMode?: unknown }) | undefined
  const mode = typeof data?.outputMode === "string" ? data.outputMode : undefined
  if (mode === "item") {
    const expr = typeof data?.itemIndex === "string" ? data.itemIndex : "1"
    return [rows[resolveIndex(expr, rows.length)] ?? rows[0]!]
  }
  if (mode?.startsWith("item:")) return [rows[parseInt(mode.slice(5), 10)] ?? rows[0]!]
  if (mode === "all") return selectListItems(rows as unknown as string[], data) as unknown as number[]
  if (hop.source === "edit-plan") return rows.filter(kept).slice(0, 1)
  return rows.length === 1 ? [...rows] : []
}

/** The plan rows the wires send the render, and each one's row in the list the
 *  render iterates (undefined for a render that runs once). A pass-through node
 *  (every hop but the last) hands on its batch by iteration, one per KEPT clip
 *  (`renderPlanValue`'s `keptClips`), so the next wire selects from — and the
 *  render is rowed in — the kept clips only. The dropped clips such a hop's
 *  selection reached are set aside with no render row (the render never reads
 *  them) so they keep their card. In plan order. */
function pickedRows(count: number, hops: readonly RenderPlanHop[], kept: (row: number) => boolean) {
  let rows: number[] = Array.from({ length: count }, (_, i) => i)
  const droppedAside: number[] = []
  for (const [i, hop] of hops.entries()) {
    if (rows.length === 0) break
    if (hop.each) {
      rows = selectListItems(rows as unknown as string[], hop.edge.data as SelectorFields | undefined) as unknown as number[]
      if (i < hops.length - 1) {
        droppedAside.push(...rows.filter((row) => !kept(row)))
        rows = rows.filter(kept)
      }
    } else {
      rows = singlePickRows(rows, hop, kept)
      if (rows.length !== 1) rows = []
    }
  }
  const rowed = hops.at(-1)?.each ?? true
  const picked: Array<{ row: number; renderRow: number | undefined }> = rows.map((row, i) => ({ row, renderRow: rowed ? i : undefined }))
  const seen = new Set(rows)
  for (const row of droppedAside) {
    if (!seen.has(row)) {
      seen.add(row)
      picked.push({ row, renderRow: undefined })
    }
  }
  return picked.sort((a, b) => a.row - b.row)
}

function clipValue(raw: unknown): Rec | undefined {
  if (typeof raw !== "string") return isRecord(raw) ? raw : undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function takeOf(entry: Rec, medium: RenderMedium): SavedRenderItem | undefined {
  const url = str(entry.url)
  if (!url) return undefined
  const jobId = str(entry.jobId)
  const thumbnailUrl = str(entry.thumbnailUrl)
  return { url, medium, ...(jobId ? { jobId } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}), ...renderResultStamp(entry) }
}

/** The newest take of each quality per clip (results are newest first). */
function newestTakes(results: readonly Rec[], medium: RenderMedium) {
  const preview = new Map<string, SavedRenderItem>()
  const final = new Map<string, SavedRenderItem>()
  for (const entry of results) {
    const item = takeOf(entry, medium)
    if (!item?.clipKey) continue
    const byKey = item.quality === "proxy" ? preview : item.quality === "final" ? final : undefined
    if (byKey && !byKey.has(item.clipKey)) byKey.set(item.clipKey, item)
  }
  return { preview, final }
}

/** The rows of the latest batch that have a row stamp and produced nothing,
 *  when that batch is a Preview. A hole's stamp is `{}` whether the row was sent
 *  and failed or was a dropped clip the run skipped; the caller tells them apart
 *  by the clip's keep. */
function failedPreviewRows(renderData: Rec, rowStamps: ClipCardsInput["rowStamps"]): ReadonlySet<number> {
  const failed = new Set<number>()
  const batch = savedRenderBatch(renderData)
  if (!batch || !rowStamps) return failed
  const qualities = batch.flatMap((item) => (item?.quality ? [item.quality] : []))
  if (qualities.length === 0 || qualities.some((q) => q !== "proxy")) return failed
  batch.forEach((item, row) => {
    const stamp = rowStamps[row]
    if (item === null && isRecord(stamp)) failed.add(row)
  })
  return failed
}

function cardState(
  card: Omit<ClipCard, "state">,
  failed: boolean,
  medium: RenderMedium,
  live: ClipLiveRun | undefined,
): ClipCardState {
  if (live && card.keep && !live.landed.has(card.clipKey)) {
    return live.quality === "final" ? "final-rendering" : "preview-rendering"
  }
  if (card.final) return card.keep ? "final-ready" : "final-not-in-set"
  if (failed) return "preview-failed"
  if (card.preview) return card.previewStale ? "preview-stale" : medium === "audio" ? "audio-only" : "preview"
  return "no-preview"
}

export function buildClipCards(input: ClipCardsInput): ClipCards | null {
  const { plan, editedEdl, renderData, hops, renderBases, rowStamps, live } = input
  const stored = clipDecisionsOf(plan, editedEdl)
  if (!stored || !Array.isArray(plan)) return null
  const decisions = input.decisions && input.decisions.length === plan.length ? input.decisions : stored
  const medium: RenderMedium = renderData.output === "audio" ? "audio" : "video"
  const results = (Array.isArray(renderData.generatedResults) ? renderData.generatedResults : []).filter(isRecord)
  const takes = newestTakes(results, medium)
  // Holes are rowed in the plan's own rows only on a wire straight from the plan.
  const failed = hops.length === 1 ? failedPreviewRows(renderData, rowStamps) : new Set<number>()
  const kept = (row: number) => decisions[row]?.keep ?? true

  const clipRows = plan.filter((_, row) => planClipKeyAt(plan, row) !== undefined).length

  const cards: ClipCard[] = []
  let picked = 0
  for (const { row, renderRow } of pickedRows(plan.length, hops, kept)) {
    const clipKey = planClipKeyAt(plan, row)
    const clip = clipValue(plan[row])
    if (!clipKey || !clip) continue
    picked++
    const edl = normalizeEdl(clip)
    const meta = isRecord(clip.meta) ? clip.meta : {}
    const decision = decisions[row] ?? { keep: true }
    const plannedHook = str(meta.hook)
    const readBasis = renderReadBasis(clip)
    const basisNow = renderBases?.get(clipKey)
    const preview = takes.preview.get(clipKey)
    const final = takes.final.get(clipKey)
    const unchanged =
      !!final && !!readBasis && final.planBasis === readBasis && basisNow !== undefined && final.renderBasis === basisNow
    const previewStale =
      !!preview && (preview.planBasis !== readBasis || (basisNow !== undefined && preview.renderBasis !== basisNow))
    const title = str(meta.title)
    const hook = decision.hook ?? plannedHook
    const card: Omit<ClipCard, "state"> = {
      row,
      ...(renderRow !== undefined ? { renderRow } : {}),
      clipKey,
      ...(title !== undefined ? { title } : {}),
      ...(plannedHook !== undefined ? { plannedHook } : {}),
      ...(hook !== undefined ? { hook } : {}),
      hookEdited: decision.hook !== undefined,
      keep: decision.keep,
      durationMs: edlDurationMs(edl),
      sourceSpan: {
        inMs: Math.min(...edl.segments.map((s) => s.inMs)),
        outMs: Math.max(...edl.segments.map((s) => s.outMs)),
      },
      ...(preview ? { preview } : {}),
      ...(final ? { final } : {}),
      unchanged,
      previewStale,
    }
    // Only a clip kept now can have been sent and failed: a dropped clip's hole
    // carries the same `{}` stamp and reads "no preview yet".
    const rowFailed = decision.keep && renderRow !== undefined && failed.has(renderRow)
    cards.push({ ...card, state: cardState(card, rowFailed, medium, live) })
  }

  const cardKeys = new Set(cards.map((c) => c.clipKey))
  const orphanFinals = [...takes.final.values()].filter((f) => !cardKeys.has(f.clipKey!))
  const keptCards = cards.filter((c) => c.keep)
  return {
    cards,
    notSent: clipRows - picked,
    orphanFinals,
    keptCount: keptCards.length,
    keptDurationMs: keptCards.reduce((sum, c) => sum + c.durationMs, 0),
    unchangedKept: keptCards.filter((c) => c.unchanged).length,
    medium,
    ...(live ? { progress: { done: live.done, total: live.total } } : {}),
  }
}

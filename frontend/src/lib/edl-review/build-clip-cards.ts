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
 *  - Failed previews (decided 2026-10-06): the latest Preview batch has ONE ROW
 *    PER RUN of the render — one per clip that run sent — never one per plan
 *    clip, so a clip dropped at run time has no row. Both engines stamp every
 *    row with what it was sent for, a failed row too (the render's
 *    `__listResultStamps`: the clip and the run's quality), and a card is
 *    `preview-failed` when a row of that batch names its clip and is empty
 *    (and no row of it landed that clip). Rows are matched to cards by
 *    `clipKey`, NEVER by position: behind Camera Switch and after a selector as
 *    on a direct wire. A clip no row names reads "no preview yet", and so does
 *    a row that never ran (`cancelled`: a Stop, or the fail-fast after another
 *    row failed). Behind a Camera Switch that did not run with the render no
 *    row is keyed (the same-run rule), so its holes read "no preview yet".
 *    A batch with no landed take is a Preview when its rows were sent at
 *    `proxy`.
 *    A batch made before every row was keyed (its empty rows name no clip)
 *    names a hole's clip only from the input the run sent that row (the
 *    browser's `__listInputs`), on a direct wire — never from its position,
 *    which a re-plan or a drop at that run can shift. Otherwise its holes read
 *    "no preview yet", never "failed".
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
  /** The row of the list the render reads that holds this clip — the list row
   *  its iteration's key is read on (`renderClipKey`); absent for a render run
   *  once, or a clip a pass-through node does not hand on. It is NOT a position
   *  in the render's batch, which has one row per run: batch rows are matched to
   *  cards by `clipKey`. */
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

/** Row `row`'s stamp in the batch (`__listResultStamps`): what it was sent
 *  for and, once it landed, what its take landed with. */
function rowStamp(renderData: Rec, row: number): Rec | undefined {
  const stamps = renderData.__listResultStamps
  const stamp = Array.isArray(stamps) ? stamps[row] : undefined
  return isRecord(stamp) ? stamp : undefined
}

/** The clip a batch row names in its stamp, if any. */
function rowStampClip(renderData: Rec, row: number): string | undefined {
  const key = rowStamp(renderData, row)?.clipKey
  return typeof key === "string" && key.length > 0 ? key : undefined
}

/**
 * The clip an UNKEYED hole was sent for, in a batch made before every row was
 * keyed: read off what the run sent that row (`__listInputs`, the browser
 * lane's per-item inputs), never guessed from its position. Only on a direct
 * wire, where the row's input is the plan's clip itself (Camera Switch can move
 * a clip's edges, so its EDL is not the clip's span), and only when the inputs
 * are this batch's: one per row, and every landed take's clip is its row's
 * input. `undefined` otherwise (a server batch has no inputs), so the hole
 * reads "no preview yet".
 */
function sentInputClips(
  batch: ReadonlyArray<SavedRenderItem | null>,
  renderData: Rec,
  hops: readonly RenderPlanHop[],
): ((row: number) => string | undefined) | undefined {
  if (hops.length !== 1) return undefined
  const inputs = renderData.__listInputs
  if (!Array.isArray(inputs) || inputs.length !== batch.length) return undefined
  for (const [row, item] of batch.entries()) {
    if (item?.clipKey && planClipKeyAt(inputs, row) !== item.clipKey) return undefined
  }
  return (row) => planClipKeyAt(inputs, row)
}

/** The clips the latest batch says failed, when it is a Preview: a row that
 *  names a clip and produced nothing, unless another row of it landed that
 *  clip. A row names its clip by its stamp, else (an older batch) by the input
 *  the run sent it (`sentInputClips`). A row that never ran (`cancelled`) is
 *  no failure. The batch's quality is what its takes landed at, else (no row
 *  landed) what its rows were sent at. */
function failedPreviewClips(renderData: Rec, hops: readonly RenderPlanHop[]): ReadonlySet<string> {
  const failed = new Set<string>()
  const batch = savedRenderBatch(renderData)
  if (!batch) return failed
  const landedQualities = batch.flatMap((item) => (item?.quality ? [item.quality] : []))
  const qualities =
    landedQualities.length > 0
      ? landedQualities
      : batch.flatMap((_, row) => {
          const quality = rowStamp(renderData, row)?.quality
          return quality === "proxy" || quality === "final" ? [quality] : []
        })
  if (qualities.length === 0 || qualities.some((q) => q !== "proxy")) return failed
  const landed = new Set(
    batch.flatMap((item, row) => {
      const key = item ? (item.clipKey ?? rowStampClip(renderData, row)) : undefined
      return key ? [key] : []
    }),
  )
  let byInput: ((row: number) => string | undefined) | undefined | null = null
  batch.forEach((item, row) => {
    if (item !== null || rowStamp(renderData, row)?.cancelled === true) return
    let key = rowStampClip(renderData, row)
    if (!key) {
      if (byInput === null) byInput = sentInputClips(batch, renderData, hops)
      key = byInput?.(row)
    }
    if (key && !landed.has(key)) failed.add(key)
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
  const { plan, editedEdl, renderData, hops, renderBases, live } = input
  const stored = clipDecisionsOf(plan, editedEdl)
  if (!stored || !Array.isArray(plan)) return null
  const decisions = input.decisions && input.decisions.length === plan.length ? input.decisions : stored
  const medium: RenderMedium = renderData.output === "audio" ? "audio" : "video"
  const results = (Array.isArray(renderData.generatedResults) ? renderData.generatedResults : []).filter(isRecord)
  const takes = newestTakes(results, medium)
  const kept = (row: number) => decisions[row]?.keep ?? true

  const clipRows = plan.filter((_, row) => planClipKeyAt(plan, row) !== undefined).length

  const drafts: Array<Omit<ClipCard, "state">> = []
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
    drafts.push(card)
  }

  // A row names its clip, so a failed one marks that clip's card whatever was
  // dropped at that run or since (the row was sent and failed).
  const failed = failedPreviewClips(renderData, hops)
  const cards: ClipCard[] = drafts.map((card) => ({ ...card, state: cardState(card, failed.has(card.clipKey), medium, live) }))
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

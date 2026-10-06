/**
 * TA3 (c), decided 2026-10-04, widened 2026-10-05 — what reopening the editor
 * shows when a run ended while it was closed.
 *
 * Podcast runs are long and often end with the tab closed. The reopen lane
 * paints the newest ended editor run (`use-workflow-persistence.ts`), but only
 * into EMPTY slots, so a render that holds an older preview kept it — and once
 * the plan's json is mapped too, it would pair the new plan with the old
 * preview, and Render final would start from that mismatch.
 *
 * So on a canvas with a render (Apply EDL), the newer run loads WHOLE: every
 * node the run actually ran — the render, everything upstream of it (its plan,
 * its transcript, its silence ranges, a Camera Switch), and, once a run has
 * marked them, the tail after it (captions, formats) and a branch no render
 * reads from (F4 below). The per-node rules
 * are the Telegram follow lane's (`paintableStates`, #1751), so a node:
 *   - that only passed its SAVED data through (a seeded state) keeps it;
 *   - emptied with "Clear results" after the run ended stays empty;
 *   - already showing this run (stamped with its id when it landed — live, or
 *     on an earlier reopen) is never painted again over what changed since;
 *   - showing a NEWER run than this one keeps it, whether or not the reopening
 *     person's listing holds that run: the listing is their own manual runs,
 *     so another member's run, a discarded run and a Telegram run are missing
 *     from it. The node's stamp says when its run ended it.
 * and a node a later single-node run (Run on the node) settled on keeps that
 * newer result. A render whose file is already one of its takes counts as
 * showing the run too: an editor from before the stamp painted it live.
 *
 * Plan, transcript and render are kept to one run (decided 2026-10-05, review
 * round 3 F1–F3), except in the cases listed at the end. The hold sources are:
 *   - a node that KEEPS a newer run (the last two rules above: a stamp newer
 *     than this run, or a later single-node run), whether or not this run ran
 *     it;
 *   - a render this run included and never COMPLETED (`unfinishedRenderIds`):
 *     one that FAILED (F3), and one still `pending` or `running` when the run
 *     ended, because it was stopped, timed out or abandoned, or failed upstream
 *     of the render (a Camera Switch), or whose job was cancelled (decided
 *     2026-10-05). It is read off the run's states, not the node's stamp, so it
 *     still holds on the next reopen. A failed render shows the failure; an
 *     unfinished one is not painted at all (`paintableStates`). Either keeps
 *     its earlier takes. A render the run only passed through, or did not
 *     include, is no source, and neither is one a Router turned off (also
 *     `skipped`, but with no job). A node that failed upstream of an unfinished
 *     render (a failed Edit Plan) is held back by it like the rest of the
 *     path: it keeps its earlier result and is not painted with the failure.
 * A source holds back (`pairedHoldIds`):
 *   - every node upstream of it, through any wire or teleport: a render that
 *     keeps run B keeps the plan, the transcript and the ranges it was cut from;
 *   - every node on the EDL PATH (a render and every node upstream of one,
 *     `edlPathIds`) that it, or a node it holds upstream, feeds. So a kept
 *     plan, or a kept node between it and the render, holds back the renders
 *     it feeds (F1); and a title writer off Transcribe that keeps a newer run
 *     holds back Transcribe, and with it the plan and the render cut from that
 *     transcript (F2).
 * The other skips (seeded, cleared, already showing this run, `landedBefore`)
 * are not sources. A held-back node stays out of the fill-only lane as well,
 * so an empty plan is not filled with this run's either.
 *
 * An UNMARKED node off the edl path (no run's id on it: the tail after a
 * render, a branch no render reads from) keeps the fill-only rule (F4): it
 * takes the run only where it is empty, and stays unmarked, so this holds on
 * every reopen until a run marks it. The first reopen after the stamps arrived
 * therefore cannot replace edits or bring back deleted takes there. A node off
 * the path that keeps a newer run or is held back stays out of the fill-only
 * lane all the same.
 *
 * Where results can still come from different runs (open; the doc lists them):
 *   - `landedBefore`: a render already holding this run's take, with an older
 *     take picked, is no source, so the plan loads.
 *   - A node held back only because a node it FEEDS is held (a render held by
 *     a kept plan) holds back nothing upstream of its own: a second source fed
 *     straight into that render, and not upstream of the kept plan, still
 *     loads.
 *   - The tail is off the edl path: a render held back still lets captions
 *     after it load from this run.
 *
 * A canvas with no render keeps the fill-only rule for every node: a
 * platform-wide "newer run wins" is outside this track.
 */
import type { FollowRun, PaintState } from "./triggered-run-follow"
import { RESULTS_RUN_ENDED_AT_KEY, RESULTS_RUN_ID_KEY, paintableStates } from "./triggered-run-follow"
import { isSeededState } from "@/lib/seeded-node-state"
import { PREVIEW_RENDER_NODE_TYPES } from "@nodaro/shared"

/**
 * The render nodes a review sits on: the shared `PREVIEW_RENDER_NODE_TYPES`
 * (TA5), itself derived from the render-node registry (SV18).
 */
export const REVIEW_RENDER_NODE_TYPES: ReadonlySet<string> = PREVIEW_RENDER_NODE_TYPES

interface GraphNode {
  readonly id: string
  readonly type?: string
  readonly data: unknown
}
interface GraphEdge {
  readonly source: string
  readonly target: string
}

const channelOf = (node: GraphNode | undefined): unknown => (node?.data as { channel?: unknown } | undefined)?.channel

/**
 * The nodes a reopen loads under these rules: every node, on a canvas with a
 * render; none otherwise (fill-only, as before).
 */
export function reviewRegionIds(nodes: readonly GraphNode[]): Set<string> {
  if (!nodes.some((n) => REVIEW_RENDER_NODE_TYPES.has(n.type ?? ""))) return new Set()
  return new Set(nodes.map((n) => n.id))
}

/**
 * Who feeds whom, wires and teleports alike: a Teleport Receive is fed by the
 * Teleport Send on its channel, with no edge between them.
 */
function wiring(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target])
  }
  const feedersOf = (id: string): string[] => {
    const node = byId.get(id)
    const viaTeleport = node?.type === "teleport-receive"
      ? nodes.filter((send) => send.type === "teleport-send" && channelOf(send) === channelOf(node)).map((send) => send.id)
      : []
    return [...(parents.get(id) ?? []), ...viaTeleport]
  }
  const fedBy = (id: string): string[] => {
    const node = byId.get(id)
    const viaTeleport = node?.type === "teleport-send"
      ? nodes.filter((recv) => recv.type === "teleport-receive" && channelOf(recv) === channelOf(node)).map((recv) => recv.id)
      : []
    return [...(children.get(id) ?? []), ...viaTeleport]
  }
  return { feedersOf, fedBy }
}

/** Every node reached from `start` (not counting `start` itself unless it is reached again). */
function reach(start: Iterable<string>, step: (id: string) => string[], within?: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>()
  const queue = [...start].flatMap(step)
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id) || (within && !within.has(id))) continue
    seen.add(id)
    queue.push(...step(id))
  }
  return seen
}

/**
 * Every node upstream of a node in `kept`, through any wire or teleport. A node
 * in `kept` is in the result only when it is also upstream of another kept node.
 */
export function heldBackIds(nodes: readonly GraphNode[], edges: readonly GraphEdge[], kept: ReadonlySet<string>): Set<string> {
  return reach(kept, wiring(nodes, edges).feedersOf)
}

/**
 * The edl path: every render and every node upstream of one (its plan, its
 * transcript, its ranges, a Camera Switch, the source). The tail after a
 * render and a branch no render reads from are off it.
 */
export function edlPathIds(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Set<string> {
  const renders = nodes.filter((n) => REVIEW_RENDER_NODE_TYPES.has(n.type ?? "")).map((n) => n.id)
  return new Set([...renders, ...reach(renders, wiring(nodes, edges).feedersOf)])
}

/**
 * The nodes a hold reaches from `sources` (nodes that keep a newer run, and
 * renders the run never completed): every node upstream of a source, and every
 * node on the edl path that a source or one of those upstream nodes feeds. So
 * a kept plan holds back the render it feeds (F1), and a transcript held back
 * by a title writer off it holds back the plan and the render cut from it (F2).
 * The sources themselves are never in the result: the caller decides what
 * each one shows.
 */
export function pairedHoldIds(nodes: readonly GraphNode[], edges: readonly GraphEdge[], sources: ReadonlySet<string>): Set<string> {
  const { feedersOf, fedBy } = wiring(nodes, edges)
  const upstream = reach(sources, feedersOf)
  const downstream = reach([...sources, ...upstream], fedBy, edlPathIds(nodes, edges))
  const held = new Set([...upstream, ...downstream])
  for (const id of sources) held.delete(id)
  return held
}

/** The fields of a listed execution these rules read (single-node rows included). */
export interface ListedRun {
  readonly id: string
  readonly triggerType?: string
  readonly status?: string
  readonly createdAt?: string
  readonly startedAt?: string | null
  readonly completedAt?: string | null
  readonly nodeStates?: Record<string, unknown>
}

function timeOf(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : Number.NaN
}

/**
 * The nodes a COMPLETED single-node run settled on after this run finished
 * them: they keep that newer result. Read off the same listing the reopen lane
 * already has (single-node runs are merged into it, one row per job, keyed by
 * the canvas node). When this run's time for the node is unknown it cannot be
 * shown to be the newer one, so the single-node result wins; a row with no
 * time of its own proves nothing and is passed over.
 */
export function laterSingleNodeRunIds(
  rows: readonly ListedRun[],
  states: Readonly<Record<string, { readonly completedAt?: string | null }>>,
  run: { readonly completedAt?: string | null },
): Set<string> {
  const later = new Set<string>()
  for (const row of rows) {
    if (row.triggerType !== "single-node" || row.status !== "completed") continue
    const sole = Object.values(row.nodeStates ?? {})[0] as { nodeId?: unknown } | undefined
    const nodeId = typeof sole?.nodeId === "string" ? sole.nodeId : undefined
    if (!nodeId || !(nodeId in states)) continue
    const rowEnded = timeOf(row.completedAt ?? row.createdAt)
    if (!Number.isFinite(rowEnded)) continue
    const runEnded = timeOf(states[nodeId]?.completedAt ?? run.completedAt)
    if (!Number.isFinite(runEnded) || rowEnded > runEnded) later.add(nodeId)
  }
  return later
}

/**
 * The run's render already landed on this node — its file is one of the node's
 * takes — before runs were stamped (an editor from before this rule painted it
 * live). Painting it again would point the media field at it while the picked
 * take stays where the person left it, and the two engines read those
 * differently. Treated like the stamp.
 */
function landedBefore(node: GraphNode | undefined, state: unknown): boolean {
  const out = ((state as { output?: unknown }).output ?? {}) as { videoUrl?: unknown; audioUrl?: unknown; imageUrl?: unknown }
  const url = [out.videoUrl, out.audioUrl, out.imageUrl].find((u): u is string => typeof u === "string" && u !== "")
  if (!url) return false
  const takes = (node?.data as { generatedResults?: unknown } | undefined)?.generatedResults
  return Array.isArray(takes) && takes.some((take) => (take as { url?: unknown } | null)?.url === url)
}

/**
 * The node shows a run other than this one that ended it at or after this run
 * ends it. Read off the end time stamped beside the run's id. A stamp from
 * before the end time was recorded is read off the listing; one whose run the
 * listing does not hold loads, as before: such stamps come only from the
 * Telegram follow lane, which repaints a newer Telegram run on its own.
 */
function showsNewerRun(node: GraphNode | undefined, state: { readonly completedAt?: string | null }, run: { readonly id: string; readonly completedAt?: string | null }, rows: readonly ListedRun[]): boolean {
  const data = (node?.data ?? {}) as Record<string, unknown>
  const shown = data[RESULTS_RUN_ID_KEY]
  if (typeof shown !== "string" || shown === "" || shown === run.id) return false
  const stamped = data[RESULTS_RUN_ENDED_AT_KEY]
  let shownEnded: number
  if (typeof stamped === "string" && stamped !== "") {
    shownEnded = timeOf(stamped)
  } else {
    const row = rows.find((r) => r.id === shown)
    if (!row) return false
    shownEnded = timeOf(row.completedAt ?? row.createdAt)
  }
  const thisEnded = timeOf(state.completedAt ?? run.completedAt)
  // An unreadable time on either side proves nothing: keep what the node shows.
  if (!Number.isFinite(shownEnded) || !Number.isFinite(thisEnded)) return true
  return shownEnded >= thisEnded
}

/**
 * A render the run included that it never COMPLETED: it failed (F3), or it was
 * still `pending` or `running` when the run ended (stopped, timed out,
 * abandoned, or failed upstream of it; decided 2026-10-05), or its job was
 * cancelled (read back as `skipped`, with the job). Each holds back its plan as
 * a kept newer run does. A render the run only passed through (a seeded state)
 * or did not include is no source, and neither is one a Router turned off: the
 * orchestrator writes that `skipped` too, but with no job. Read off the run,
 * not the node, so it still holds on the next reopen.
 */
function unfinishedRenderIds(nodes: readonly GraphNode[], states: Readonly<Record<string, PaintState>>): Set<string> {
  return new Set(
    nodes
      .filter((n) => {
        const state = states[n.id]
        return REVIEW_RENDER_NODE_TYPES.has(n.type ?? "") && state !== undefined && !isSeededState(state) && isUnfinished(state)
      })
      .map((n) => n.id),
  )
}

function isUnfinished(state: PaintState): boolean {
  switch (state.status) {
    case "failed":
    case "pending":
    case "running":
      return true
    case "skipped":
      return !!state.jobId
    default:
      return false
  }
}

/**
 * Which of an ended run's node states load (see the header), and the region
 * these rules own: the fill-only lane leaves it alone, so the older run never
 * fills a node these rules kept or held back. An unmarked node off the edl
 * path is left to the fill-only lane (F4).
 */
export function reviewStatesToLoad<S extends PaintState>(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  run: Pick<FollowRun, "id" | "completedAt"> & { readonly nodeStates: Readonly<Record<string, S>> },
  rows: readonly ListedRun[],
): { readonly load: Record<string, S>; readonly region: Set<string> } {
  const everyNode = reviewRegionIds(nodes)
  if (everyNode.size === 0) return { load: {}, region: everyNode }
  // Read for EVERY node, not only those the run ran: a render this run never
  // reached can still keep a newer run, and the plan it ran must then wait.
  const timeFor = (id: string) => ({ completedAt: run.nodeStates[id]?.completedAt ?? null })
  const later = laterSingleNodeRunIds(rows, Object.fromEntries(nodes.map((n) => [n.id, timeFor(n.id)])), run)
  const keptNewer = new Set(
    nodes.filter((n) => later.has(n.id) || showsNewerRun(n, timeFor(n.id), run, rows)).map((n) => n.id),
  )
  const unfinishedRenders = unfinishedRenderIds(nodes, run.nodeStates)
  const heldBack = pairedHoldIds(nodes, edges, new Set([...keptNewer, ...unfinishedRenders]))
  const path = edlPathIds(nodes, edges)
  const region = new Set(
    nodes
      .filter((n) => path.has(n.id) || keptNewer.has(n.id) || heldBack.has(n.id) || isMarked(n))
      .map((n) => n.id),
  )
  const inRegion = Object.fromEntries(Object.entries(run.nodeStates).filter(([id]) => region.has(id)))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const paintable = paintableStates(nodes, inRegion, { id: run.id, completedAt: run.completedAt, active: false })
  const load = Object.fromEntries(
    Object.entries(paintable).filter(
      ([id, state]) => !keptNewer.has(id) && !heldBack.has(id) && !landedBefore(byId.get(id), state),
    ),
  ) as Record<string, S>
  return { load, region }
}

/** Some run's results were already loaded onto the node and marked with that run. */
function isMarked(node: GraphNode): boolean {
  const shown = ((node.data ?? {}) as Record<string, unknown>)[RESULTS_RUN_ID_KEY]
  return typeof shown === "string" && shown !== ""
}

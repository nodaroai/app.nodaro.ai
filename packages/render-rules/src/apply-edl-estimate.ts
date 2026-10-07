/**
 * How many OUTPUT MINUTES an Apply EDL render is ESTIMATED at — the one rule
 * every estimate of a render's length reads (decided 2026-10-07): the editor's
 * run estimate (the node's pill, the Run button, the run-confirm dialog, the
 * Execute-All precheck) and the listing a published app, component or
 * template stores (`listingEstimate` in the backend's credits). A built-in
 * template's stored price is that listing, so the price on its card and the
 * editor's estimate after cloning it assume the same render length.
 *
 * Apply EDL is priced per rendered minute: the server reserves
 * `rate × max(1, ceil(edlDurationMs / 60000))` (`backend/src/lib/apply-edl-plan.ts`).
 * Quoting the bare per-minute rate — ONE minute — for every render let a
 * 45-minute cut that reserves 450 be quoted at 10.
 *
 * What this is, honestly: a REALISTIC ESTIMATE, not a guaranteed upper bound. The
 * render's true length is decided by an upstream plan that does not exist yet, so
 * no pre-run number can be both safe and useful — a guaranteed bound for a clip
 * pack (each clip may legally span a whole 15-minute planner window) would refuse
 * most runs the user can afford, which is a harm too. This prices what a render
 * realistically costs and leans high.
 *
 * Two situations, told apart by `rerunIds` (the nodes about to execute):
 *
 *   EXACT — the EDL that will render already exists:
 *     · nothing is wired into `edl` → the node's own inline EDL;
 *     · the wired producer is NOT re-running (a single-node Run, the node's own
 *       pill, a Render final that does not re-plan) → the producer's persisted
 *       plan is precisely what renders.
 *
 *   ESTIMATED — the producer re-plans in this run, so the plan on the canvas is
 *   the PREVIOUS run's and must not be used (last week's shorter episode would
 *   under-quote this week's):
 *     · Edit Plan, tighten → the episode's own length: the longer of the master
 *       and the transcribed media (the planner spans both); unknown → the
 *       180-minute ceiling;
 *     · Edit Plan, clips → per clip, twice the clip-length target, never more
 *       than the episode (the clip COUNT is the fan-out multiplier's job);
 *     · Edit Plan, trailer → twice the longest teaser the mode plans (40 s),
 *       never more than the episode;
 *     · Camera Switch → whatever feeds ITS edit: switching cameras never
 *       changes an edit's length;
 *     · anything else → the 180-minute ceiling.
 */
import {
  edlDurationMs,
  editPlanSavedOutput,
  editPlanSourceDurationSec,
  normalizeEdl,
  EDIT_PLAN_MAX_MINUTES,
  type EditPlanSavedOutput,
} from "@nodaro/shared"

/** A node and a wire as the estimate reads them: either engine's graph fits. */
export interface EstimateGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
}
export interface EstimateGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

/** An Edit Plan's saved output with the person's review applied. The editor
 *  passes its cached reader; the default is the shared read itself. */
export type EditPlanOutputReader = (data: Readonly<Record<string, unknown>>) => EditPlanSavedOutput | undefined

/** The clip length priced when the node sets no target. The planner is given no
 *  length in that case, so this is an assumption about typical clips, not a
 *  plugin default. */
export const ASSUMED_CLIP_TARGET_SEC = 90
/** The target is something the planner aims near, not a clamp: price double. */
export const CLIP_LENGTH_HEADROOM = 2
/** Trailer mode plans one 20–40 s teaser; priced at double its longest. */
export const TRAILER_MAX_SEC = 40

const minutesOf = (sec: number): number => Math.max(1, Math.ceil(sec / 60))

const dataOf = (n: EstimateGraphNode | undefined): Record<string, unknown> =>
  (n?.data as Record<string, unknown> | undefined) ?? {}

// ── The episode length an Edit Plan spans ─────────────────────────────────

/**
 * Design-time length fields some video producers carry INSTEAD of `duration`
 * (render-video `durationSeconds`, video-to-video `videoDuration`, video-retake
 * `videoDurationSec`, edit-video-pro `sourceDurationSec`). Each must exist on a
 * node data type — pinned by the editor's `__tests__/edit-plan-estimate.test.ts`,
 * because a key nothing writes is silently dead.
 */
export const EDIT_PLAN_LEGACY_DURATION_KEYS = [
  "durationSeconds",
  "videoDuration",
  "videoDurationSec",
  "sourceDurationSec",
] as const

/** Walk a teleport-send/receive chain back to the producing node — the same
 *  transparency both run resolvers apply (frontend `resolveTeleportOrigin`,
 *  backend input-resolver). A teleport node carries no media fields of its own. */
export function resolveGraphOrigin<N extends EstimateGraphNode>(
  start: N | undefined,
  nodes: readonly N[],
  edges: readonly EstimateGraphEdge[],
): N | undefined {
  let current = start
  const visited = new Set<string>()
  while (
    current &&
    (current.type === "teleport-send" || current.type === "teleport-receive") &&
    !visited.has(current.id)
  ) {
    visited.add(current.id)
    const id = current.id
    const inEdge = edges.find((e) => e.target === id)
    const upstream = inEdge ? nodes.find((n) => n.id === inEdge.source) : undefined
    if (!upstream) break
    current = upstream
  }
  return current
}

/** The master source's node data: the `master-audio` role when one is set, else
 *  the first source in the node's own `sourceOrder`, else first-wired. */
function masterSourceData(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
): Record<string, unknown> | undefined {
  const data = dataOf(node)
  const cfg = (data.sourceConfig as Record<string, { role?: string }> | undefined) ?? {}
  const order = (data.sourceOrder as string[] | undefined) ?? []
  const srcIds = edges
    .filter((e) => e.target === node.id && e.targetHandle === "sources")
    .map((e) => e.source)
  const ordered = order.length
    ? [...order.filter((id) => srcIds.includes(id)), ...srcIds.filter((id) => !order.includes(id))]
    : srcIds
  const masterId = ordered.find((id) => cfg[id]?.role === "master-audio") ?? ordered[0]
  if (!masterId) return undefined
  const origin = resolveGraphOrigin(nodes.find((n) => n.id === masterId), nodes, edges)
  return origin?.data as Record<string, unknown> | undefined
}

/**
 * The master source's known length in seconds, or undefined (→ ceiling bucket).
 * O(edges) and returns a primitive, so it is safe inside a store selector.
 *
 * Unknown is deliberate, and it is why there is NO transcript fallback here
 * even though the reserve has one: the server reads THIS run's transcript,
 * while a canvas only ever holds the PREVIOUS run's. A stale transcript would
 * UNDER-quote; the ceiling over-quotes instead, which refuses up front and
 * charges nothing.
 */
export function resolveEditPlanEstimateDurationSec(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
): number | undefined {
  return mediaLengthSecOf(masterSourceData(node, nodes, edges))
}

/**
 * A media node's own recorded length in seconds, from its DATA: the shared
 * reserve-parity read first, then the legacy design-time keys. The one read every
 * estimate resolver uses, so "how long is this source" has a single answer.
 */
export function mediaLengthSecOf(data: Record<string, unknown> | undefined): number | undefined {
  if (!data) return undefined
  const known = editPlanSourceDurationSec(data)
  if (known !== undefined) return known
  for (const key of EDIT_PLAN_LEGACY_DURATION_KEYS) {
    const v = data[key]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v
  }
  return undefined
}

/**
 * A media node's data with every length `mediaLengthSecOf` reads removed: the
 * shape a listing prices a source the app user or a template's cloner
 * REPLACES with their own recording (decided 2026-10-07). The creator's sample
 * length is not theirs, so the length is unknown and a length-dependent price
 * lists per minute. Kept beside the reader so the two cannot drift (a guard
 * test checks the reader finds no length in the result). Every other field is
 * kept; the input is never mutated.
 */
export function withoutMediaLength(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) }
  delete out.duration
  for (const key of EDIT_PLAN_LEGACY_DURATION_KEYS) delete out[key]
  if (Array.isArray(out.generatedResults)) {
    out.generatedResults = out.generatedResults.map((r: unknown) => {
      if (!r || typeof r !== "object") return r
      const { duration: _duration, ...rest } = r as Record<string, unknown>
      return rest
    })
  }
  if (out.metadata && typeof out.metadata === "object") {
    const { durationSeconds: _durationSeconds, ...rest } = out.metadata as Record<string, unknown>
    out.metadata = rest
  }
  return out
}

// ── The render's minutes ───────────────────────────────────────────────────

/**
 * Minutes of ONE EDL value, measured the way every server ingress measures it:
 * a JSON string is parsed (both engines, the route and the MCP verb accept one),
 * then `normalizeEdl` (it coerces and can LENGTHEN a sloppy EDL), then
 * `edlDurationMs`. `undefined` = there is no EDL here at all. A non-empty EDL
 * that cannot be measured prices the ceiling — never the one-minute floor.
 */
function edlMinutes(value: unknown): number | undefined {
  let raw = value
  if (typeof raw === "string") {
    if (!raw.trim()) return undefined
    try {
      raw = JSON.parse(raw)
    } catch {
      return undefined // the server parses this to nothing and 400s before any reserve
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  try {
    const edl = normalizeEdl(raw)
    if (edl.segments.length === 0) return undefined
    const ms = edlDurationMs(edl)
    return Number.isFinite(ms) && ms > 0 ? minutesOf(ms / 1000) : EDIT_PLAN_MAX_MINUTES
  } catch {
    return EDIT_PLAN_MAX_MINUTES
  }
}

/** Nodes whose output EDL is their input EDL re-cut by camera, never longer
 *  or shorter: the estimate reads through them to the edit that feeds them.
 *  Each holds `{ edl, transcript }` on `generatedJson`. */
export const EDL_LENGTH_PRESERVING_TYPES: ReadonlySet<string> = new Set(["camera-switch"])

/**
 * The EDL a producer holds — what its `edl` output would deliver now:
 * `generatedJson`, the field the `json`/`edl` output handles read; for an Edit
 * Plan, with the person's review applied (`planOutputOf`). A clips plan is a
 * bare `Edl[]`. A length-preserving producer holds `{ edl, transcript }` per run
 * and, run once per clip, the whole batch on `__listResults` (`generatedJson` is
 * then only whichever clip finished last).
 */
export function persistedEdlPlan(
  producer: EstimateGraphNode,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): unknown {
  const data = dataOf(producer)
  // An Edit Plan holds its plan as the person's review leaves it (TA13): the
  // edited cut, or the KEPT clips only — what the render will be handed.
  if (producer.type === "edit-plan") return planOutputOf(data)?.json
  const held = data.generatedJson
  if (!EDL_LENGTH_PRESERVING_TYPES.has(producer.type ?? "")) return held
  const batch = Array.isArray(data.__listResults) && data.__listResults.length > 0 ? (data.__listResults as unknown[]) : undefined
  return batch ?? (Array.isArray(held) ? unwrapAll(held) : unwrapSwitched(held))
}

const unwrapSwitched = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && "edl" in v ? (v as { edl: unknown }).edl : v)

/** The same held array always unwraps to the same array, so a store selector
 *  built on `persistedEdlPlan` returns a stable value while nothing changed. */
const unwrappedCache = new WeakMap<readonly unknown[], readonly unknown[]>()
function unwrapAll(held: readonly unknown[]): readonly unknown[] {
  let out = unwrappedCache.get(held)
  if (!out) {
    out = held.map(unwrapSwitched)
    unwrappedCache.set(held, out)
  }
  return out
}

/** The plan a producer holds, in output minutes. */
function persistedPlanMinutes(producer: EstimateGraphNode, planOutputOf: EditPlanOutputReader): number | undefined {
  const plan = persistedEdlPlan(producer, planOutputOf)
  if (Array.isArray(plan)) {
    // Each clip renders in its own iteration; price the LONGEST so no single
    // iteration's reserve is under-quoted (the fan-out multiplier counts them).
    const each = plan.map(edlMinutes).filter((m): m is number => m !== undefined)
    return each.length > 0 ? Math.max(...each) : undefined
  }
  return edlMinutes(plan)
}

/**
 * The episode length an Edit Plan will span. The planner works over
 * `max(transcript end, probed master)`, so when the transcript was made from
 * DIFFERENT media than the master, the longer of the two is the honest figure.
 * `undefined` = unknown.
 */
export function resolveEditPlanEpisodeSec(
  plan: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
): number | undefined {
  const masterSec = resolveEditPlanEstimateDurationSec(plan, nodes, edges)
  if (masterSec === undefined) return undefined

  const tEdge = edges.find((e) => e.target === plan.id && e.targetHandle === "transcript")
  const transcriber = tEdge ? resolveGraphOrigin(nodes.find((n) => n.id === tEdge.source), nodes, edges) : undefined
  if (transcriber?.type !== "transcribe") return masterSec
  const mediaEdge = edges.find((e) => e.target === transcriber.id)
  const media = mediaEdge ? resolveGraphOrigin(nodes.find((n) => n.id === mediaEdge.source), nodes, edges) : undefined
  const mediaSec = media ? mediaLengthSecOf(dataOf(media)) : undefined
  return mediaSec !== undefined ? Math.max(masterSec, mediaSec) : masterSec
}

/**
 * A render's estimated length, in two parts: minutes that do not depend on the
 * episode, and minutes per minute of an episode whose length is not known yet
 * (decided 2026-10-07: a listing whose price follows the recording's length
 * lists that part per minute, not at the ceiling). A tighten of an unknown
 * episode is `{ fixedMinutes: 0, perEpisodeMinute: 1 }`: the cut is never
 * longer than the episode. Everything else, including a known length, is fixed.
 */
export interface RenderEstimateLength {
  readonly fixedMinutes: number
  readonly perEpisodeMinute: number
}

/** The minutes a length stands for when the episode is as long as it may be (the 180-minute cap). */
export function renderLengthCeilingMinutes(length: RenderEstimateLength): number {
  return length.fixedMinutes + length.perEpisodeMinute * EDIT_PLAN_MAX_MINUTES
}

const fixedLength = (minutes: number): RenderEstimateLength => ({ fixedMinutes: minutes, perEpisodeMinute: 0 })

/**
 * The length a re-planning Edit Plan's render is estimated at, from its
 * settings and the episode it spans (`undefined` = unknown length).
 */
export function editPlanRenderEstimateLength(
  plan: Readonly<Record<string, unknown>>,
  episodeSec: number | undefined,
): RenderEstimateLength {
  if (plan.mode === "clips") {
    const target =
      typeof plan.targetDurationSec === "number" && plan.targetDurationSec > 0
        ? plan.targetDurationSec
        : ASSUMED_CLIP_TARGET_SEC
    const perClip = minutesOf(target * CLIP_LENGTH_HEADROOM)
    // A clip is never longer than the episode it is cut from.
    return fixedLength(episodeSec !== undefined ? Math.min(perClip, minutesOf(episodeSec)) : perClip)
  }
  if (plan.mode === "trailer") {
    const teaser = minutesOf(TRAILER_MAX_SEC * CLIP_LENGTH_HEADROOM)
    return fixedLength(episodeSec !== undefined ? Math.min(teaser, minutesOf(episodeSec)) : teaser)
  }
  return episodeSec !== undefined
    ? fixedLength(Math.min(EDIT_PLAN_MAX_MINUTES, minutesOf(episodeSec)))
    : { fixedMinutes: 0, perEpisodeMinute: 1 }
}

/**
 * The minutes a re-planning Edit Plan's render is estimated at, from its
 * settings and the episode it spans (`undefined` = unknown length): the
 * length at its ceiling.
 */
export function editPlanRenderEstimateMinutes(
  plan: Readonly<Record<string, unknown>>,
  episodeSec: number | undefined,
): number {
  return renderLengthCeilingMinutes(editPlanRenderEstimateLength(plan, episodeSec))
}

function wiredEdlLength(
  edlEdge: EstimateGraphEdge,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader,
): RenderEstimateLength {
  const producer = resolveGraphOrigin(nodes.find((n) => n.id === edlEdge.source), nodes, edges)
  if (!producer) return fixedLength(EDIT_PLAN_MAX_MINUTES)

  // EXACT: the producer is not re-running, so its persisted plan is what renders.
  if (!rerunIds.has(producer.id)) {
    const exact = persistedPlanMinutes(producer, planOutputOf)
    if (exact !== undefined) return fixedLength(exact)
  }

  if (EDL_LENGTH_PRESERVING_TYPES.has(producer.type ?? "")) {
    const upstream = edges.find((e) => e.target === producer.id && e.targetHandle === "edl")
    return upstream ? wiredEdlLength(upstream, nodes, edges, rerunIds, planOutputOf) : fixedLength(EDIT_PLAN_MAX_MINUTES)
  }

  if (producer.type === "edit-plan") {
    return editPlanRenderEstimateLength(dataOf(producer), resolveEditPlanEpisodeSec(producer, nodes, edges))
  }
  return fixedLength(EDIT_PLAN_MAX_MINUTES)
}

/**
 * The render's estimated length in its two parts ({@link RenderEstimateLength}).
 * What a LISTING prices: a tighten of an episode not yet known is per minute
 * of it. Parameters as {@link resolveApplyEdlEstimateMinutes}.
 */
export function resolveApplyEdlEstimateLength(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): RenderEstimateLength {
  // Both engines keep the LAST wired `edl` value, and nothing stops a second wire
  // landing on the handle — so price the costliest of them, never just the first.
  const edlEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "edl")
  if (edlEdges.length === 0) {
    // Nothing wired: the inline EDL is what renders. No EDL at all → the run
    // fails validation before any reserve, so one minute is the honest floor.
    return fixedLength(edlMinutes(dataOf(node).edl) ?? 1)
  }
  return edlEdges
    .map((e) => wiredEdlLength(e, nodes, edges, rerunIds, planOutputOf))
    .reduce((a, b) => (renderLengthCeilingMinutes(b) > renderLengthCeilingMinutes(a) ? b : a))
}

/**
 * The minutes a render is estimated at: its length at the ceiling, what a run
 * estimate prices (an episode of unknown length is priced at the 180-minute cap).
 *
 * @param rerunIds ids of the nodes about to EXECUTE. Pass the executable set for
 *   a whole-workflow / run-selected estimate (or a listing's whole graph); pass
 *   an empty set for a single-node estimate (the node's pill, its Run button),
 *   where nothing upstream re-plans.
 * @param planOutputOf how an Edit Plan's saved output is read (the editor
 *   passes its cached reader).
 */
export function resolveApplyEdlEstimateMinutes(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  planOutputOf: EditPlanOutputReader = editPlanSavedOutput,
): number {
  return renderLengthCeilingMinutes(resolveApplyEdlEstimateLength(node, nodes, edges, rerunIds, planOutputOf))
}

/**
 * How many OUTPUT MINUTES an Apply EDL node's credit ESTIMATE should price.
 *
 * Apply EDL is priced per rendered minute: the server reserves
 * `rate × max(1, ceil(edlDurationMs / 60000))` (`backend/src/lib/apply-edl-plan.ts`).
 * The estimate used to quote the bare per-minute rate — ONE minute — for every
 * render, so a 45-minute cut that reserves 450 was quoted at 10. That estimate is
 * what Execute-All prechecks the balance against: the run passed the precheck,
 * Transcribe and Edit Plan charged, then the render's reserve was refused.
 *
 * What this is, honestly: a REALISTIC ESTIMATE, not a guaranteed upper bound. The
 * render's true length is decided by an upstream plan that does not exist yet, so
 * no browser-side number can be both safe and useful — a guaranteed bound for a
 * clip pack (each clip may legally span a whole 15-minute planner window) would
 * refuse most runs the user can afford, which is a harm too. Closing that gap
 * exactly needs a server-side reserve for the whole run at execution start; until
 * then this prices what a render realistically costs and leans high.
 *
 * Two situations, told apart by `rerunIds` (the nodes about to execute):
 *
 *   EXACT — the EDL that will render already exists:
 *     · nothing is wired into `edl` → the node's own inline EDL;
 *     · the wired producer is NOT re-running (a single-node Run, the node's own
 *       pill) → the producer's persisted plan is precisely what renders.
 *
 *   ESTIMATED — the producer re-plans in this run, so the plan on the canvas is
 *   the PREVIOUS run's and must not be used (last week's shorter episode would
 *   under-quote this week's):
 *     · Edit Plan, tighten → the episode's own length: the longer of the master
 *       and the transcribed media (the planner spans both);
 *     · Edit Plan, clips → per clip, twice the clip-length target, never more
 *       than the episode (the clip COUNT is the fan-out multiplier's job);
 *     · Camera Switch → whatever feeds ITS edit: switching cameras never
 *       changes an edit's length;
 *     · anything else → the 180-minute ceiling.
 */
import { edlDurationMs, normalizeEdl, EDIT_PLAN_MAX_MINUTES } from "@nodaro/shared"
import {
  mediaLengthSecOf,
  resolveEditPlanEstimateDurationSec,
  resolveGraphOrigin,
  type GraphEdge,
  type GraphNode,
} from "@/lib/edit-plan-estimate"

/** The clip length priced when the node sets no target. The planner is given no
 *  length in that case, so this is an assumption about typical clips, not a
 *  plugin default. */
const ASSUMED_CLIP_TARGET_SEC = 90
/** The target is something the planner aims near, not a clamp: price double. */
const CLIP_LENGTH_HEADROOM = 2

const minutesOf = (sec: number): number => Math.max(1, Math.ceil(sec / 60))

const dataOf = (n: GraphNode | undefined): Record<string, unknown> =>
  (n?.data as Record<string, unknown> | undefined) ?? {}

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
 * The EDL a producer holds on the canvas — what its `edl` output would deliver
 * now: `generatedJson`, the field the `json`/`edl` output handles read. A clips
 * plan is a bare `Edl[]`. A length-preserving producer holds `{ edl, transcript }`
 * per run and, run once per clip, the whole batch on `__listResults`
 * (`generatedJson` is then only whichever clip finished last). The estimate's
 * reader; the Apply EDL panel's badge reads what the engines read instead
 * (`apply-edl-render-input.ts`).
 */
export function persistedEdlPlan(producer: GraphNode): unknown {
  const data = dataOf(producer)
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

/** The plan a producer holds on the canvas, in output minutes. */
function persistedPlanMinutes(producer: GraphNode): number | undefined {
  const plan = persistedEdlPlan(producer)
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
function editPlanEpisodeSec(
  plan: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
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

function wiredEdlMinutes(
  edlEdge: GraphEdge,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  rerunIds: ReadonlySet<string>,
): number {
  const producer = resolveGraphOrigin(nodes.find((n) => n.id === edlEdge.source), nodes, edges)
  if (!producer) return EDIT_PLAN_MAX_MINUTES

  // EXACT: the producer is not re-running, so its persisted plan is what renders.
  if (!rerunIds.has(producer.id)) {
    const exact = persistedPlanMinutes(producer)
    if (exact !== undefined) return exact
  }

  if (EDL_LENGTH_PRESERVING_TYPES.has(producer.type ?? "")) {
    const upstream = edges.find((e) => e.target === producer.id && e.targetHandle === "edl")
    return upstream ? wiredEdlMinutes(upstream, nodes, edges, rerunIds) : EDIT_PLAN_MAX_MINUTES
  }

  if (producer.type === "edit-plan") {
    const plan = dataOf(producer)
    const episodeSec = editPlanEpisodeSec(producer, nodes, edges)
    if (plan.mode === "clips") {
      const target =
        typeof plan.targetDurationSec === "number" && plan.targetDurationSec > 0
          ? plan.targetDurationSec
          : ASSUMED_CLIP_TARGET_SEC
      const perClip = minutesOf(target * CLIP_LENGTH_HEADROOM)
      // A clip is never longer than the episode it is cut from.
      return episodeSec !== undefined ? Math.min(perClip, minutesOf(episodeSec)) : perClip
    }
    if (episodeSec !== undefined) return Math.min(EDIT_PLAN_MAX_MINUTES, minutesOf(episodeSec))
  }
  return EDIT_PLAN_MAX_MINUTES
}

/**
 * @param rerunIds ids of the nodes about to EXECUTE. Pass the executable set for
 *   a whole-workflow / run-selected estimate; pass an empty set for a single-node
 *   estimate (the node's pill, its Run button), where nothing upstream re-plans.
 */
export function resolveApplyEdlEstimateMinutes(
  node: GraphNode,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  rerunIds: ReadonlySet<string>,
): number {
  // Both engines keep the LAST wired `edl` value, and nothing stops a second wire
  // landing on the handle — so price the costliest of them, never just the first.
  const edlEdges = edges.filter((e) => e.target === node.id && e.targetHandle === "edl")
  if (edlEdges.length === 0) {
    // Nothing wired: the inline EDL is what renders. No EDL at all → the run
    // fails validation before any reserve, so one minute is the honest floor.
    return edlMinutes(dataOf(node).edl) ?? 1
  }
  return Math.max(...edlEdges.map((e) => wiredEdlMinutes(e, nodes, edges, rerunIds)))
}

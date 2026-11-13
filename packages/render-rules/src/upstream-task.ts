/**
 * Which upstream node's provider task a task-chained node may run against —
 * Extend Video on VEO, Runway or Grok, and Upscale Video on VEO (1080p / 4K)
 * or Seedance 2.5 HD, each of which works on a generation BY its task, never
 * by its URL. One rule for the server's workflow run (input-resolver.ts) and
 * the editor (node-input-resolver.ts, upstream-kie-task-id.ts), so the task a
 * node is handed is the same wherever it runs.
 *
 * A node hands on a task only when (a) it is the task of its OWN run's output
 * — its generation's, or its extension's — and (b) its model fits the target:
 * a VEO generation or VEO extension to a VEO extend or upscale; a Runway
 * generation or Runway extension to a Runway extend; a Grok Imagine text- or
 * image-to-video generation (never a Grok extension, which KIE does not
 * extend) to a Grok extend; a Seedance 2.5 generation (its draft, which the
 * finalize's own check confirms) to Seedance 2.5 HD. A mis-wired node is
 * handed nothing and keeps the refusal it gives without a task, before
 * anything is reserved.
 *
 * Where a run's output task is recorded: a generation node holds it in
 * `kieTaskId`. An Extend or Upscale Video node holds in `kieTaskId` the task
 * it works ON (its source's, which an MCP call or an older run may have
 * written), so its own run's output task is recorded apart, in
 * `outputKieTaskId` ({@link RUN_OUTPUT_TASK_FIELD}); on the server a node that
 * ran in this run hands on its output's task directly.
 */
import { isSeedanceDraftCapable, SEEDANCE_DRAFT_FINALIZE_PROVIDER } from "@nodaro/shared/model-catalog"
import { canonicalVideoProvider, isGrokExtendProvider, isGrokExtendSourceModel, isVeoProvider } from "@nodaro/shared/models"
import { EXTEND_VIDEO_DEFAULT_PROVIDER } from "./node-default-models"

/** The node types whose `kieTaskId` is an INPUT — the task they work on — never their own run's output task. */
const TASK_CONSUMER_NODE_TYPES: ReadonlySet<string> = new Set(["extend-video", "video-upscale"])

/** Where an Extend or Upscale Video node records its own run's output task (its `kieTaskId` is its input). */
export const RUN_OUTPUT_TASK_FIELD = "outputKieTaskId"

/** The Runway generation model whose task Runway's extend continues. */
const RUNWAY_GENERATION_MODEL = "runway-kie"

/** A node as both engines hold it: its type and its data (the model it runs is `data.provider`). */
export interface UpstreamTaskNode {
  readonly id?: string
  readonly type?: string
  readonly data?: unknown
}

const dataOf = (node: UpstreamTaskNode): Record<string, unknown> => (node.data ?? {}) as Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/** The Extend Video provider a node runs as (its default when it names none; a retired id as the one it became). */
const extendProviderOf = (node: UpstreamTaskNode): string => canonicalVideoProvider(str(dataOf(node).provider) ?? EXTEND_VIDEO_DEFAULT_PROVIDER)

/** What made a source's output: a generation by a model, or an extension by an Extend Video provider; null for an upscale. */
type SourceOrigin = { readonly kind: "generation"; readonly model: unknown } | { readonly kind: "extension"; readonly provider: string } | null

function originOf(source: UpstreamTaskNode): SourceOrigin {
  if (source.type === "extend-video") return { kind: "extension", provider: extendProviderOf(source) }
  if (source.type === "video-upscale") return null
  return { kind: "generation", model: dataOf(source).provider }
}

const isVeoGeneration = (o: SourceOrigin): boolean => o?.kind === "generation" && typeof o.model === "string" && isVeoProvider(o.model)

/** Whether `target` works on the task of an output with this origin; false when the target takes no task. */
function targetTakes(target: UpstreamTaskNode, origin: SourceOrigin): boolean {
  if (origin === null) return false
  if (target.type === "extend-video") {
    const runsAs = extendProviderOf(target)
    if (runsAs === "veo-extend") return isVeoGeneration(origin) || (origin.kind === "extension" && origin.provider === "veo-extend")
    if (runsAs === "runway-extend") {
      return (origin.kind === "generation" && origin.model === RUNWAY_GENERATION_MODEL) || (origin.kind === "extension" && origin.provider === "runway-extend")
    }
    if (isGrokExtendProvider(runsAs)) return origin.kind === "generation" && isGrokExtendSourceModel(origin.model)
    return false
  }
  if (target.type === "video-upscale") {
    const provider = dataOf(target).provider
    if (provider === "veo-1080p" || provider === "veo-4k") return isVeoGeneration(origin) || (origin.kind === "extension" && origin.provider === "veo-extend")
    if (provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER) return origin.kind === "generation" && typeof origin.model === "string" && isSeedanceDraftCapable(origin.model)
    return false
  }
  return false
}

/**
 * Whether `target` may run against the provider task of `source` (the node
 * wired into it): what made `source`'s output — a generation's model, or an
 * extension's provider — is one whose task `target` works on.
 */
export function upstreamTaskFits(target: UpstreamTaskNode, source: UpstreamTaskNode): boolean {
  return targetTakes(target, originOf(source))
}

/**
 * The graph a task is read in: its nodes and wires, and — on the server — the
 * output task of each node that ran in this run (its node state's).
 */
export interface UpstreamTaskGraph {
  readonly nodes: ReadonlyArray<UpstreamTaskNode & { readonly id: string }>
  readonly edges: ReadonlyArray<{ readonly source: string; readonly target: string }>
  /** The task a node's run in THIS run produced, when it ran (the server's node state). */
  readonly runOutputTaskOf?: (nodeId: string) => string | undefined
}

const NO_GRAPH: UpstreamTaskGraph = { nodes: [], edges: [] }

/** A wired task: whether a source that fits is wired into the node at all, and the task the first such source hands on. */
interface WiredTask {
  readonly fits: boolean
  readonly task?: string
}

/** How deep a chain of extensions is followed when telling an old output from an input (cycles stop here too). */
const MAX_CHAIN_DEPTH = 32

function wiredTaskOf(target: UpstreamTaskNode, graph: UpstreamTaskGraph, depth: number): WiredTask {
  if (target.id === undefined || depth > MAX_CHAIN_DEPTH) return { fits: false }
  let fits = false
  for (const edge of graph.edges) {
    if (edge.target !== target.id) continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source || !upstreamTaskFits(target, source)) continue
    fits = true
    const task = ownOutputTaskOf(source, graph, depth + 1)
    if (task !== undefined) return { fits, task }
  }
  return { fits }
}

/**
 * The task of `node`'s own run's output, or undefined: its output's in this
 * run (`graph.runOutputTaskOf`); else as its data records it — a generation's
 * `kieTaskId`; an Extend or Upscale Video node's {@link RUN_OUTPUT_TASK_FIELD}.
 *
 * A graph saved before an extension recorded its output task apart holds it
 * in the node's `kieTaskId` instead (a server run overwrote the task it worked
 * on with its output). Such a `kieTaskId` is read as its OWN output exactly
 * when it differs from the task the node's wired source hands it; equal to
 * it, it is the task it worked on (an MCP-written node's), never handed on.
 * With no source that fits wired, it cannot be told apart, and is read as the
 * task it works on.
 */
function ownOutputTaskOf(node: UpstreamTaskNode, graph: UpstreamTaskGraph, depth: number): string | undefined {
  const ran = node.id !== undefined ? str(graph.runOutputTaskOf?.(node.id)) : undefined
  if (ran !== undefined) return ran
  const data = dataOf(node)
  if (node.type === undefined || !TASK_CONSUMER_NODE_TYPES.has(node.type)) return str(data.kieTaskId)
  const recorded = str(data[RUN_OUTPUT_TASK_FIELD])
  if (recorded !== undefined) return recorded
  const saved = str(data.kieTaskId)
  if (saved === undefined) return undefined
  const wired = wiredTaskOf(node, graph, depth)
  return wired.fits && saved !== wired.task ? saved : undefined
}

/**
 * The task of `source`'s own run's output as its data (and, on the server, its
 * node state) records it — see {@link ownOutputTaskOf}; never the task an
 * Extend or Upscale Video node works on.
 */
export function recordedRunOutputTaskOf(source: UpstreamTaskNode, graph: UpstreamTaskGraph = NO_GRAPH): string | undefined {
  return ownOutputTaskOf(source, graph, 0)
}

/**
 * The task `target` is handed from `source`, or undefined: `source`'s own
 * run's output task ({@link recordedRunOutputTaskOf}) when what made it fits
 * the target ({@link upstreamTaskFits}).
 */
export function handedOnTaskOf(
  target: UpstreamTaskNode,
  source: UpstreamTaskNode,
  graph: UpstreamTaskGraph = NO_GRAPH,
): string | undefined {
  if (!upstreamTaskFits(target, source)) return undefined
  return ownOutputTaskOf(source, graph, 0)
}

/**
 * The task a task-chained node may run against from its OWN data, when no
 * wired source hands it one: its `kieTaskId` (an MCP-written node's input) —
 * but only when no source that fits is wired into it. Wired to one, the wire
 * is its input: a `kieTaskId` it holds then is stale, or its own old output
 * (a graph saved before outputs were recorded apart), and it never runs
 * against that — it takes what its source hands on, or nothing (refused).
 */
export function ownTaskInputOf(node: UpstreamTaskNode, graph: UpstreamTaskGraph = NO_GRAPH): string | undefined {
  const saved = str(dataOf(node).kieTaskId)
  if (saved === undefined) return undefined
  return wiredTaskOf(node, graph, 0).fits ? undefined : saved
}

/**
 * The fields a finished run of a node of `type` records its output task in,
 * beside the `kieTaskId` every node is given: for an Extend or Upscale Video
 * node, {@link RUN_OUTPUT_TASK_FIELD} (its `kieTaskId` is its input); nothing
 * for any other node (its `kieTaskId` is its own output). Empty without a task.
 */
export function runOutputTaskFields(type: string | undefined, outputTask: unknown): Record<string, string> {
  const task = str(outputTask)
  return task !== undefined && type !== undefined && TASK_CONSUMER_NODE_TYPES.has(type) ? { [RUN_OUTPUT_TASK_FIELD]: task } : {}
}

/**
 * The execution the editor's Render final continues (`continueFromExecutionId`
 * on `/run`): the server run whose Preview it renders. A Render final that
 * continues that run is stamped into its continue-from-failed lineage exactly
 * like an agent's Render final (the server's subset continuation, `via:
 * "subset"`), so a later "Continue from failed" of the run knows the Preview's
 * final is done instead of answering `continuation_preview_pending` and
 * rendering it, and charging for it, again.
 *
 * A continuation hands on that run's recorded output for every node it does
 * not run (`continuationSeeds`, server), where a plain run reads the saved
 * workflow. Continuing must never change what the final renders or charges,
 * so the Render final continues the run only when the two read the same thing
 * on every wire into the run set; otherwise it is a plain run of the render and
 * the nodes after it, as it always was:
 *  - the run is named: the server run the render's take came from
 *    (`resultsRunId`), or the run a "Continue from failed" answer named;
 *  - it is a run of THIS workflow that ended `completed` (`resultsRunId` can
 *    also be a single-node JOB id, a browser run of the render: no execution);
 *  - every node feeding the run set from outside it reads the same both ways
 *    (`feederReadsTheSame`). A node feeds the run set the way the run set
 *    itself is built (`buildFeedMaps`, Teleport pairs crossed): by a wire, by
 *    Group membership, or by a field mapping (which outlives the wire it was
 *    made from; a parameter picker read only that way is skipped: the server
 *    reads it from its data both ways). Reading the same means: the run
 *    recorded it as completed; the canvas holds a single result of it (a list
 *    reader of a plain run reads every saved result, a continuation the run's
 *    one); and what the canvas hands on is what the run recorded:
 *     - a node the run read from its own data (a source, a parameter, a frozen
 *       node): its value is still the value it read (one plain media URL or
 *       text, compared as is; a JSON value, such as a Transcribe's transcript,
 *       compared as JSON on the handle it is read on; anything else is not
 *       compared and reads as different);
 *     - a node the run ran, or handed on from an earlier run: the canvas shows
 *       THAT run's result (its `resultsRunId`), and the canvas's value on the
 *       handle is the recorded one (a take deleted or replaced since fails it,
 *       whatever the stamp says). The recorded value follows the handle the way
 *       the server reads it (`getPrimaryOutput`): a pip the server hands on as
 *       JSON (`recordedJsonOf`) is compared as JSON, ignoring key order (jsonb
 *       does not keep it), whatever its preview kind; a media or text pip by
 *       its value; a data pip with no recorded JSON (a plan marker) by the
 *       stamp alone;
 *     - an Edit Plan: the plan the run recorded, before any review, is the
 *       canvas's own plan (`generatedJson`). The server re-applies the saved
 *       review to it (`editPlanSeedOutput`), exactly as a plain run applies
 *       it to the saved plan, so the review itself is never compared.
 * A run the server named is continued whatever the canvas shows: the lineage
 * is held at it, and a plain final would leave it held (its next "Continue
 * from failed" would answer the same Preview again).
 *
 * The check is read-only, asked within the newer-run check's window; past that
 * limit the run goes ahead as a plain run.
 */
import { bypassTeleports } from "@nodaro/render-rules"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared/catalogs"
import { isRenderNodeType, renderTranscriptOutputOf, RENDER_JSON_HANDLE } from "@nodaro/shared/nodes"
import { buildFeedMaps, type FeedNode } from "@nodaro/shared/workflow"
import { getWorkflowExecution, type WorkflowExecution } from "@/lib/api"
import { isSeededState } from "@/lib/seeded-node-state"
import { deepEqual } from "@/lib/workflow-delta"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { detectPreviewItemType, extractNodeOutput } from "./execution-graph"
import { RESULTS_RUN_ID_KEY } from "./triggered-run-follow"

/** A node state of the run, as the reads below need it. */
export interface RecordedState {
  readonly status?: unknown
  readonly output?: Readonly<Record<string, unknown>>
  readonly fromSavedData?: boolean
  readonly seededFromExecution?: string | null
  readonly startedAt?: string | null
  readonly jobId?: string | null
}

/** The run a Render final may continue, as read from the server. */
export interface ContinuableRun {
  readonly id: string
  /** Its node states: what a continuation hands on for each node it does not run. */
  readonly nodeStates: Readonly<Record<string, RecordedState | undefined>>
  /** The server named it (a "Continue from failed" answer): continued whatever the canvas shows. */
  readonly named: boolean
}

/** Is `exec` a run of `workflowId` a Render final can continue? Pure. */
export function isContinuableRun(exec: Pick<WorkflowExecution, "id" | "kind" | "workflowId" | "status" | "triggerType">, workflowId: string): boolean {
  return exec.kind !== "job" && exec.workflowId === workflowId && exec.status === "completed" && exec.triggerType !== "app_run"
}

/** The run the render's take came from (`resultsRunId`), when it names one. */
export function takeRunOf(render: WorkflowNode | undefined): string | null {
  const id = (render?.data as Record<string, unknown> | undefined)?.[RESULTS_RUN_ID_KEY]
  return typeof id === "string" && id.length > 0 ? id : null
}

/**
 * Read the candidate run and answer the run to continue, or `null` (a plain
 * run). Never throws: a run that cannot be read is not continued.
 */
export async function readContinuableRun(
  candidate: string | null,
  workflowId: string,
  named: boolean,
  read?: (id: string) => Promise<WorkflowExecution>,
): Promise<ContinuableRun | null> {
  if (!candidate) return null
  try {
    // Resolved inside the guard: a read that cannot even be made is no run to continue.
    const exec = await (read ?? getWorkflowExecution)(candidate)
    if (!isContinuableRun(exec, workflowId)) return null
    return { id: exec.id, nodeStates: (exec.nodeStates ?? {}) as ContinuableRun["nodeStates"], named }
  } catch {
    return null
  }
}

/** One read of a node outside the run set by the run set: the node, and the handle it is read on (none: its primary output). */
export interface FeederRead {
  readonly source: string
  readonly sourceHandle?: string | null
}

/** Does `node` map one of its fields from `source` (`data.fieldMappings`, the shape `buildFeedMaps` reads)? */
function mapsFrom(node: WorkflowNode | undefined, source: string): boolean {
  const mappings = (node?.data as { fieldMappings?: unknown } | undefined)?.fieldMappings
  if (!mappings || typeof mappings !== "object") return false
  return Object.values(mappings as Record<string, unknown>).some((m) => (m as { sourceNodeId?: unknown } | null)?.sourceNodeId === source)
}

/**
 * Every read of a node outside the run set by a node in it. The feeders are
 * the run set's parents in `buildFeedMaps` (a wire, Group membership, a field
 * mapping), over the wires with Teleport pairs crossed, the rule the run set
 * itself is built by. A wire is read on its own handle; a Group member and a
 * mapping source on the primary output. A parameter picker fed in only by a
 * mapping is left out: the server reads it from its data either way. Pure.
 */
export function feederReads(runSet: ReadonlySet<string>, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): FeederRead[] {
  const wires = bypassTeleports(nodes, edges as ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null }>)
  const { parents } = buildFeedMaps(nodes as unknown as readonly FeedNode[], wires)
  const feeders = new Set<string>()
  for (const id of runSet) for (const parent of parents.get(id) ?? []) if (!runSet.has(parent)) feeders.add(parent)
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const reads: FeederRead[] = []
  for (const source of feeders) {
    const wired = wires.filter((w) => w.source === source && runSet.has(w.target))
    for (const w of wired) reads.push({ source, sourceHandle: w.sourceHandle })
    const node = byId.get(source)
    const member = typeof node?.parentId === "string" && runSet.has(node.parentId)
    const mapped = !PARAMETER_NODE_TYPES.has(node?.type ?? "") && [...runSet].some((id) => mapsFrom(byId.get(id), source))
    // A Group member, or a mapping source: its primary output.
    if (member || mapped) reads.push({ source })
  }
  return reads
}

/** The one plain value a state built from saved data hands on: a media URL or text, and nothing else. */
function plainValueOf(output: Readonly<Record<string, unknown>> | undefined): string | null {
  if (!output) return null
  const keys = Object.keys(output).filter((k) => output[k] !== undefined && output[k] !== null)
  if (keys.length !== 1) return null
  const [key] = keys as [string]
  if (!["imageUrl", "videoUrl", "audioUrl", "text"].includes(key)) return null
  const value = output[key]
  return typeof value === "string" ? value : null
}

/** What a recorded output hands on as a media or text value of `kind`: the field the server reads first for it, else its first plain value. */
function recordedValueOf(output: Readonly<Record<string, unknown>> | undefined, kind: "image" | "video" | "audio" | "text"): string | undefined {
  if (!output) return undefined
  const field = kind === "image" ? "imageUrl" : kind === "video" ? "videoUrl" : kind === "audio" ? "audioUrl" : "text"
  const own = output[field]
  if (typeof own === "string") return own
  const first = output.imageUrl ?? output.videoUrl ?? output.audioUrl ?? output.text
  return typeof first === "string" ? first : undefined
}

/**
 * The JSON the server hands on from a recorded output on this handle, as
 * `getPrimaryOutput` (backend output-extractor.ts) stringifies it, or
 * `undefined` when that read carries none (a media pip of a render). Camera
 * Switch hands on one half of its pair per pip, Forced Alignment its
 * alignment, a render its `json` or its own transcript pip; every other JSON
 * pip (Transcribe, Text to Dialogue, Web Scrape, the readers, the analyses…)
 * is `output.json`. Edit Plan is compared by `samePlan`, never here. A pip the
 * server reads some other way than these simply never matches: a plain run.
 */
export function recordedJsonOf(type: string, sourceHandle: string | undefined, output: Readonly<Record<string, unknown>> | undefined): unknown {
  if (!output) return undefined
  if (type === "camera-switch") {
    const pair = output.json as { edl?: unknown; transcript?: unknown } | null | undefined
    return sourceHandle === "transcript" ? pair?.transcript : pair?.edl
  }
  if (type === "forced-alignment") return output.alignment
  if (isRenderNodeType(type)) {
    if (sourceHandle === RENDER_JSON_HANDLE) return output.json
    const pip = renderTranscriptOutputOf(type)?.handle
    return pip !== undefined && pip !== RENDER_JSON_HANDLE && sourceHandle === pip ? output.transcript : undefined
  }
  return output.json
}

/** A canvas value that is a JSON object or array, parsed; anything else (plain text, a URL, a JSON scalar): `undefined`. */
function parsedJsonOf(shown: string | undefined): object | undefined {
  if (typeof shown !== "string") return undefined
  const head = shown.trimStart()[0]
  if (head !== "{" && head !== "[") return undefined
  try {
    const parsed: unknown = JSON.parse(shown)
    return typeof parsed === "object" && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The JSON half of the read: `true` / `false` when the run recorded a JSON
 * value for this handle and the canvas hands one on (equal, ignoring key
 * order), `undefined` when the read is not a JSON one.
 */
function sameJson(node: WorkflowNode, state: RecordedState, sourceHandle: string | undefined, shown: string | undefined): boolean | undefined {
  const recorded = recordedJsonOf(node.type ?? "", sourceHandle, state.output)
  if (recorded === undefined || recorded === null) return undefined
  const parsed = parsedJsonOf(shown)
  return parsed === undefined ? undefined : deepEqual(parsed, recorded)
}

/**
 * Is what the canvas hands on, on this handle, the value the run recorded?
 * Read the way the server reads the handle: a JSON pip as JSON (`sameJson`),
 * a media or text pip by its value. A data pip with no recorded JSON (a plan
 * marker) is left to the stamp. Anything that cannot be compared reads as
 * different.
 */
function handsOnTheRecordedValue(node: WorkflowNode, state: RecordedState, sourceHandle: string | null | undefined): boolean {
  const handle = sourceHandle ?? undefined
  let shown: string | undefined
  try {
    shown = extractNodeOutput(node, handle)
  } catch {
    return false
  }
  const json = sameJson(node, state, handle, shown)
  if (json !== undefined) return json
  const kind = detectPreviewItemType(node.type ?? "", shown, handle)
  if (kind === "data") {
    // A JSON the run recorded that the canvas no longer hands on (a take deleted, cleared): different.
    const recorded = recordedJsonOf(node.type ?? "", handle, state.output)
    return recorded === undefined || recorded === null
  }
  const recorded = recordedValueOf(state.output, kind)
  if (shown === undefined || recorded === undefined) return false
  return kind === "text" ? shown.trim() === recorded.trim() : shown === recorded
}

/** An Edit Plan: the plan the run recorded, before any review (`plannedJson`, else `json`), is the canvas's own plan. */
function samePlan(node: WorkflowNode, state: RecordedState): boolean {
  const output = state.output
  if (!output) return false
  const planned = output.plannedJson ?? output.json
  const own = (node.data as Record<string, unknown>).generatedJson
  return planned !== undefined && planned !== null && own !== undefined && own !== null && deepEqual(planned, own)
}

/**
 * Does the node read the same on this handle whether the final continues the
 * run (its recorded state) or runs plain (the saved workflow, which the canvas
 * shows)? False whenever it cannot tell. Pure.
 */
export function feederReadsTheSame(run: ContinuableRun, node: WorkflowNode | undefined, sourceHandle: string | null | undefined): boolean {
  if (!node) return false
  const state = run.nodeStates[node.id]
  if (!state || state.status !== "completed") return false
  const data = node.data as Record<string, unknown>
  const results = data.generatedResults
  if (Array.isArray(results) && results.length > 1) return false
  // The server re-applies the saved review to the plan it recorded: the plans must match.
  if (node.type === "edit-plan") {
    if (!samePlan(node, state)) return false
    if (state.fromSavedData === true) return true
  } else if (state.fromSavedData === true) {
    // The run read the node's own data: it must still hold that value.
    let shown: string | undefined
    try {
      shown = extractNodeOutput(node, sourceHandle ?? undefined)
    } catch {
      return false
    }
    const recorded = plainValueOf(state.output)
    if (recorded !== null) return shown === recorded
    // Not one plain value: a JSON pip (a Transcribe's transcript read from the
    // node's data by a Run from here) is compared as JSON; anything else is not.
    return sameJson(node, state, sourceHandle ?? undefined, shown) === true
  } else if (!handsOnTheRecordedValue(node, state, sourceHandle)) {
    // A take deleted or replaced since: the stamp alone would still say "this run".
    return false
  }
  const shown = data[RESULTS_RUN_ID_KEY]
  if (isSeededState({ ...state, status: "completed" })) {
    // Handed on from an earlier run: the canvas must show that run's result.
    return typeof state.seededFromExecution === "string" && state.seededFromExecution.length > 0 && shown === state.seededFromExecution
  }
  // The run ran it: the canvas must show this run's result.
  return shown === run.id
}

/** The id the Render final continues, decided on the graph it runs on now; `undefined` for a plain run. Pure. */
export function continueFromFor(
  run: ContinuableRun | null,
  runSet: ReadonlySet<string>,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): string | undefined {
  if (!run) return undefined
  if (run.named) return run.id
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const same = feederReads(runSet, nodes, edges).every((r) => feederReadsTheSame(run, byId.get(r.source), r.sourceHandle))
  return same ? run.id : undefined
}

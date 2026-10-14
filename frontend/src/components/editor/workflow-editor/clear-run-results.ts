/**
 * "Clear results" — wipe what RUNS left on the canvas, and nothing a person put there.
 *
 * A run writes onto node data: generated media, text, lists, job ids, progress,
 * errors. Changing a workflow after a run means looking at stale output beside
 * the edit, so the editor offers one button that takes the canvas back to
 * "never ran". Everything here is a pure function of the graph; the store
 * applies the outcome in ONE update, which is what makes it a single undo step
 * (see `editGraph` on the workflow store).
 *
 * Two questions decide what is cleared:
 *
 * 1. WHICH NODES. Only nodes whose results are OUTPUTS — the executable types.
 *    A source node's `generatedResults` is the person's own upload history, and
 *    an entity or Scene card IS its generated content (a library entity with
 *    its own studio; a storyboard people approve shot by shot): neither is a
 *    run result. Those cards lose only their run STATE (a failed badge, a
 *    stale job id); sources are never touched.
 *
 * 2. WHICH KEYS. `EXECUTION_DATA_KEYS` (@nodaro/shared) is the registry of
 *    runtime/result fields, minus the members that are really config
 *    (`RUN_RESULT_KEEP_KEYS`), plus the output fields that were never
 *    registered there (`RUN_RESULT_EXTRA_KEYS`, `RUN_RESULT_TYPE_KEYS`) — one
 *    classification in @nodaro/render-rules (run-result-keys.ts), which the UGC
 *    publish strip applies too.
 *    `__tests__/clear-run-results-coverage.test.ts` scans the execution modules
 *    and fails when a run starts writing a key nobody has classified.
 *
 * A cleared node is also STAMPED (`resultsClearedAt`, see lib/results-cleared.ts):
 * on load the editor recovers results onto empty nodes, and without the stamp
 * it would read a cleared canvas as "ran while I was closed" and undo the clear.
 *
 * Deliberately NOT cleared: the composer / 3D-scene plan documents
 * (`COMPOSER_PLAN_FIELDS` and their revision bookkeeping). A run authors them,
 * but people and the copilot then EDIT them — they are documents, not output.
 */
import { COMPOSER_PLAN_FIELDS } from "@nodaro/shared/models"
import { TRANSIENT_RUNTIME_KEYS, isExpandedClone } from "@nodaro/shared/workflow"
import { RUN_RESULT_EXTRA_KEYS, RUN_RESULT_KEEP_KEYS, RUN_RESULT_TYPE_KEYS, isRunResultKey } from "@nodaro/render-rules"
import { NODE_DEF_MAP, type PreviewItem, type PreviewNodeData, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { getPreviewItemKey } from "@/lib/preview-items"
import { RESULTS_CLEARED_AT_KEY } from "@/lib/results-cleared"
import { collectPreviewItems } from "./preview-items"
import { isExecutableNode } from "./types"

/**
 * Which keys are a run's result (`RUN_RESULT_KEEP_KEYS`, `RUN_RESULT_EXTRA_KEYS`,
 * `RUN_RESULT_TYPE_KEYS`, read through `isRunResultKey`) is one classification in
 * @nodaro/render-rules, the one the UGC publish strip applies too. Re-exported here
 * for the editor's readers.
 */
export { RUN_RESULT_EXTRA_KEYS, RUN_RESULT_KEEP_KEYS, RUN_RESULT_TYPE_KEYS }

/** Run STATE only — what a content card may lose. Never its content. */
const RUN_STATE_KEYS: ReadonlySet<string> = new Set([
  ...[...TRANSIENT_RUNTIME_KEYS].filter((key) => !RUN_RESULT_KEEP_KEYS.has(key)),
  "errorMessage",
  "errorHint",
  "jobRecovering",
  // The Scene card's second status: its video half runs separately from its stills.
  "videoExecutionStatus",
])

const PLAN_DOCUMENT_KEYS: ReadonlySet<string> = new Set(COMPOSER_PLAN_FIELDS)

/**
 * Cards whose generated content IS the thing, not a by-product of a run: an
 * entity mirrors a library row with its own studio, a Scene holds the
 * keyframes and clips people approve one by one, and a Script is rewritten
 * scene by scene in its panel — those edits live INSIDE `generatedScript`, and
 * no re-run brings them back. (Re-running the node still replaces the script.)
 */
const CONTENT_NODE_TYPES: ReadonlySet<string> = new Set([
  "character",
  "face",
  "object",
  "creature",
  "location",
  "scene",
  "generate-script",
])

/**
 * Nodes whose last result a person may KEEP (Keep result: UGC Creator, UGC
 * Script). The result, the outputs the node hands on and what its card shows
 * are one thing, so Clear results never takes them apart: only a run's STATE
 * leaves these nodes, and the type's own run results (UGC Creator's options
 * waiting for a pick, and their note).
 */
const KEPT_RESULT_NODE_TYPES: ReadonlySet<string> = new Set(["ugc-creator", "ugc-script"])

/** Non-executable nodes that still hold a snapshot of the last run. */
const SNAPSHOT_TYPES: ReadonlySet<string> = new Set(["collect"])

/** Counters and flags whose zero value already means "nothing here". */
const ZERO_IS_EMPTY: ReadonlySet<string> = new Set([
  "currentJobProgress",
  "activeResultIndex",
  "__listTotal",
  "__listCompleted",
  "__pickedTotal",
  "__restTotal",
  "__upstreamCount",
])
const FALSE_IS_EMPTY: ReadonlySet<string> = new Set(["isStreaming", "jobAwaitingReview", "jobConnectionLost", "jobRecovering", "__listRunning"])
const IDLE_IS_EMPTY: ReadonlySet<string> = new Set(["executionStatus", "videoExecutionStatus"])

/**
 * What "Clear results" may take from a node: every run result (`results`); a
 * kept-result node's run state and its type's own run results (`kept`); a
 * content card's run state alone (`run-state`); nothing (`none`).
 */
export type ClearScope = "results" | "kept" | "run-state" | "none"

function dataOf(node: WorkflowNode): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>
}

/** What "Clear results" may take from this node. */
export function clearScopeOf(node: WorkflowNode): ClearScope {
  const type = node.type ?? ""
  const data = dataOf(node)
  // A pipeline-owned node mirrors an entity in the pipeline's own tables; the
  // pipeline panel — not the canvas — decides what it holds.
  const boundToPipeline = typeof data.pipeline_entity_id === "string" && data.pipeline_entity_id.length > 0
  if (type === "generative-pipeline" || data.pipeline_owned === true || boundToPipeline) return "none"
  if (CONTENT_NODE_TYPES.has(type)) return "run-state"
  if (KEPT_RESULT_NODE_TYPES.has(type)) return "kept"
  if (isExecutableNode(node) || SNAPSHOT_TYPES.has(type)) return "results"
  return "none"
}

function isClearedKey(key: string, type: string, scope: ClearScope): boolean {
  if (scope === "run-state") return RUN_STATE_KEYS.has(key)
  if (scope === "kept") return RUN_STATE_KEYS.has(key) || (RUN_RESULT_TYPE_KEYS[type]?.includes(key) ?? false)
  if (PLAN_DOCUMENT_KEYS.has(key)) return false
  return isRunResultKey(key, type)
}

/** A kept-result node still holding what it hands on (its outputs): a card WITH content. */
const holdsKeptOutputs = (data: Record<string, unknown>): boolean => {
  const outputs = data.ugcOutputs
  return !!outputs && typeof outputs === "object" && !Array.isArray(outputs) && Object.keys(outputs).length > 0
}

/** True when the value already reads as "no result" — so the node is not reported as cleared for it. */
function isEmptyResultValue(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true
  if (value === 0) return ZERO_IS_EMPTY.has(key)
  if (value === false) return FALSE_IS_EMPTY.has(key)
  if (value === "idle") return IDLE_IS_EMPTY.has(key)
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object") return Object.keys(value as object).length === 0
  return false
}

/** A COPY of a default: the definitions are module-level and shared by every node of the type. */
function freshDefault(value: unknown): unknown {
  if (Array.isArray(value)) return [...value]
  return value !== null && typeof value === "object" ? { ...(value as object) } : value
}

/**
 * The node's data with its run results removed, or null when there is nothing
 * to remove. A cleared key goes back to the node type's own default when the
 * type declares one (`generatedResults: []`, `executionStatus: "idle"`, …) and
 * is dropped otherwise — either way the node reads like one that never ran.
 */
function clearedNodeData(node: WorkflowNode): Record<string, unknown> | null {
  const scope = clearScopeOf(node)
  if (scope === "none") return null
  const type = node.type ?? ""
  const data = dataOf(node)
  const defaults = NODE_DEF_MAP.get(type)?.defaultData as Record<string, unknown> | undefined
  let next: Record<string, unknown> | null = null
  for (const key of Object.keys(data)) {
    if (!isClearedKey(key, type, scope)) continue
    if (isEmptyResultValue(key, data[key])) continue
    // A content card that finished is simply a card WITH content: "completed"
    // is not a leftover there, and resetting it would report a clear that
    // changed nothing anyone can see. So is a kept-result node that still holds
    // what it hands on.
    if (IDLE_IS_EMPTY.has(key) && data[key] === "completed" && (scope === "run-state" || (scope === "kept" && holdsKeptOutputs(data)))) continue
    next ??= { ...data }
    if (defaults && key in defaults) next[key] = freshDefault(defaults[key])
    else delete next[key]
  }
  return next
}

interface ListColumn {
  readonly connectedSourceId?: string
}

/**
 * A List's CONNECTED columns are filled by upstream runs; its manual columns
 * are typed in by a person. Returns the rows with only the connected cells
 * emptied, or null when there is nothing to empty. One implementation for the
 * run-start reset (`clearConnectedListRows`) and for Clear results.
 */
export function clearedConnectedListRows(node: WorkflowNode): string[][] | null {
  if (node.type !== "list") return null
  const data = dataOf(node)
  // `hasRunResults` calls this while the canvas RENDERS, on graphs an agent or
  // an import may have written: a malformed table must read as "nothing to
  // clear", never throw.
  const columns = Array.isArray(data.columns) ? (data.columns as readonly (ListColumn | null)[]) : []
  if (columns.length === 0) return null
  const connected = new Set(columns.flatMap((column, index) => (column?.connectedSourceId ? [index] : [])))
  if (connected.size === 0) return null
  const rows = Array.isArray(data.rows) ? (data.rows as string[][]) : []
  // Every column connected: collapse to one empty row, so the live upstream
  // resolver drives the row count from scratch.
  if (connected.size === columns.length) return [columns.map(() => "")]
  return rows.map((row) => (Array.isArray(row) ? row.map((cell, index) => (connected.has(index) ? "" : cell)) : row))
}

function sameRows(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, r) => {
    const other = b[r]
    if (!Array.isArray(row) || !Array.isArray(other)) return row === other
    return row.length === other.length && row.every((cell, c) => cell === other[c])
  })
}

/** The List's rows after a clear, or null when they would not change. */
function clearedListRowsIfChanged(node: WorkflowNode): string[][] | null {
  const next = clearedConnectedListRows(node)
  if (!next) return null
  const current = Array.isArray(dataOf(node).rows) ? (dataOf(node).rows as string[][]) : []
  return sameRows(current, next) ? null : next
}

function isRunning(node: WorkflowNode): boolean {
  const data = dataOf(node)
  const status = data.executionStatus
  return (
    status === "running" ||
    status === "pending" ||
    data.isStreaming === true ||
    data.__listRunning === true ||
    data.jobAwaitingReview === true
  )
}

/**
 * Something on the canvas is still running — this tab's run, a restored poll,
 * or a server-side run mirrored in. Clearing under it would be repainted by
 * the next status tick, so the caller refuses instead.
 */
export function isRunInProgress(nodes: readonly WorkflowNode[]): boolean {
  return nodes.some(isRunning)
}

/**
 * Per data object: would the clear change it? The canvas asks on EVERY render
 * (a drag re-renders at 60 Hz) and a drag replaces the nodes array while every
 * `data` object keeps its identity — so the answer is worked out once per data
 * object, not once per frame.
 */
const clearableByData = new WeakMap<object, boolean>()

function hasClearableData(node: WorkflowNode): boolean {
  const data = node.data as object | undefined
  if (!data) return false
  const known = clearableByData.get(data)
  if (known !== undefined) return known
  const clearable = clearedNodeData(node) !== null || clearedListRowsIfChanged(node) !== null
  clearableByData.set(data, clearable)
  return clearable
}

/** Whether "Clear results" would change anything — drives the button's enabled state. */
export function hasRunResults(nodes: readonly WorkflowNode[]): boolean {
  return nodes.some((node) => isExpandedClone(node) || hasClearableData(node))
}

/** The Preview node's own notion of "nothing changed" — it must agree, or its effect writes again. */
function samePreviewItems(a: readonly PreviewItem[], b: readonly PreviewItem[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (item, i) =>
        item.value === b[i].value &&
        item.type === b[i].type &&
        getPreviewItemKey(item) === getPreviewItemKey(b[i]) &&
        item.sourceNodeLabel === b[i].sourceNodeLabel,
    )
  )
}

export interface ClearRunResultsOutcome {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
  /** Nodes that lost something — what the confirmation reports. */
  readonly clearedCount: number
}

/**
 * The graph with every run result removed, or null when there is none.
 * Untouched nodes keep their identity, so nothing that did not change re-renders.
 * `clearedAt` (see `resultsClearedWatermark`) is stamped on every node whose
 * results went, so the load-time recovery lanes leave it empty.
 */
export function clearRunResults(
  nodes: readonly WorkflowNode[],
  edges: WorkflowEdge[],
  clearedAt: string,
): ClearRunResultsOutcome | null {
  // Expanded list clones (`node_7_iter_0`) ARE results: one card per item of a
  // finished fan-out, with the original hidden behind them. Same collapse the
  // run handlers do before a run — sub-workflow scratch nodes stay hidden.
  const cloneIds = new Set(nodes.filter((node) => isExpandedClone(node)).map((node) => node.id))
  const hadClones = cloneIds.size > 0

  let clearedCount = 0
  const cleared = nodes
    .filter((node) => !cloneIds.has(node.id))
    .map((node) => {
      const data = clearedNodeData(node)
      const rows = clearedListRowsIfChanged(node)
      const unhide = hadClones && node.hidden === true && !node.id.startsWith("__sub_")
      if (!data && !rows && !unhide) return node
      if (data || rows) clearedCount++
      const nextData = {
        ...(data ?? dataOf(node)),
        ...(rows ? { rows } : {}),
        // Only where RESULTS went: a content card keeps its content, so the
        // recovery lanes already see it as "has a result" and leave it alone.
        // A kept-result node is stamped too: its waiting options may have gone,
        // and nothing from a run before the clear may paint them back.
        ...(data && (clearScopeOf(node) === "results" || clearScopeOf(node) === "kept") ? { [RESULTS_CLEARED_AT_KEY]: clearedAt } : {}),
      }
      return { ...node, ...(unhide ? { hidden: false } : {}), data: nextData } as WorkflowNode
    })

  if (clearedCount === 0 && !hadClones) return null

  const nextEdges = hadClones ? edges.filter((edge) => !cloneIds.has(edge.source) && !cloneIds.has(edge.target)) : edges

  // A Preview lists what its upstream produced. Its own effect would re-collect
  // after the clear — as a SECOND store write, which is a second undo step and
  // never happens at all while the node is off-screen. Recollect here instead.
  // Repeated until it settles: a Preview can feed another Preview, which reads
  // the first one's ITEMS — one pass would leave the second a step behind.
  let withPreviews = cleared
  const previewCount = cleared.filter((node) => node.type === "preview").length
  for (let pass = 0; pass < previewCount; pass++) {
    const current = withPreviews
    let changed = false
    withPreviews = current.map((node) => {
      if (node.type !== "preview") return node
      const previous = node.data as PreviewNodeData
      const { ordered, itemOrder } = collectPreviewItems(node.id, current, nextEdges, previous)
      if (samePreviewItems(previous.previewItems ?? [], ordered)) return node
      changed = true
      return { ...node, data: { ...previous, previewItems: ordered, itemOrder } } as WorkflowNode
    })
    if (!changed) break
  }

  return { nodes: withPreviews, edges: nextEdges, clearedCount }
}

/**
 * Field names on a node's `data` that hold runtime / result / transient execution
 * state (job ids, progress, generated outputs, fan-out bookkeeping). These are NEVER
 * part of a node's reusable configuration.
 *
 * Single source of truth, consumed by:
 *  - the workflow store's undo logic (execution-only updates skip undo capture, so job
 *    polling does not pollute undo history or flip `isDirty`)
 *  - the node-preset extractor (presets must never capture runtime state)
 *  - the backend defensive strip on preset writes
 *
 * When adding a new runtime/result field to a node's data, add its key here.
 */
export const EXECUTION_DATA_KEYS: ReadonlySet<string> = new Set([
  "executionStatus",
  "currentJobId",
  "currentJobProgress",
  "errorMessage",
  "isStreaming",
  "generatedImageUrl",
  "generatedVideoUrl",
  "generatedAudioUrl",
  "generatedText",
  "generatedScript",
  "generatedItems",
  "generatedResults",
  "activeResultIndex",
  "sourceImageUrl",
  "__listTotal",
  "__listCompleted",
  "__listResults",
  // List fan-out window flag (abandon-guard exemption). Set/cleared by
  // executeNodeForList — purely execution-related, never user-edited.
  "__listRunning",
  // Selector node dual-channel outputs (picked + rest). Server-side execution
  // output, not user-edited config.
  "pickedResults",
  "restResults",
  "__pickedResults",
  "__restResults",
  "__pickedTotal",
  "__restTotal",
  "generatedJson",
  "subWorkflowProgress",
  "outputResults",
  "shots",
  "result",
  "processedResult",
  "activeRoutes",
  "routeOutputs",
  "_upstreamRefresh",
  "zoom",
  // Character LoRA training status fields — written every 8s while training.
  "loraReplicateVersion",
  "loraTriggerWord",
  "loraTrainingStatus",
  // Collect (fan-in) execution snapshot.
  "lastInputs",
  "lastMeta",
  "__upstreamCount",
])

/**
 * The PURE RUN-STATE subset of EXECUTION_DATA_KEYS: per-tick values (status
 * flips, job ids, progress counters, fan-out bookkeeping) that must NEITHER
 * mark the workflow dirty NOR be persisted in the save payload. Everything
 * else in EXECUTION_DATA_KEYS is a RESULT the user expects to survive reload
 * (generated URLs/results, errorMessage, LoRA outputs, collect snapshots).
 *
 * Why this split exists: writing these keys used to set `isDirty`, so job
 * polling phantom-dirtied passive tabs → spurious autosaves → false
 * "changed in another tab" banners → the remote-ahead latch froze autosave
 * (the "not saved for a long time" report). Consumed by the workflow
 * store's dirty decision and the save-payload sanitizer below.
 *
 * Invariant (guarded by node-runtime-keys.test.ts): subset of
 * EXECUTION_DATA_KEYS — anything transient is also undo-exempt.
 */
export const TRANSIENT_RUNTIME_KEYS: ReadonlySet<string> = new Set([
  "executionStatus",
  "currentJobId",
  "currentJobProgress",
  "isStreaming",
  "subWorkflowProgress",
  "__listTotal",
  "__listCompleted",
  "__listRunning",
  "_upstreamRefresh",
  "__upstreamCount",
])

/**
 * Pure save-payload sanitizer: returns new node objects with the transient
 * run-state keys removed from `data`. Nodes without transient keys (or
 * without `data`) are returned by reference — cheap for the common case.
 */
export function stripTransientRuntimeData<
  T extends { data?: Record<string, unknown> | undefined },
>(nodes: readonly T[]): T[] {
  return nodes.map((node) => {
    const data = node.data
    if (!data) return node
    let hasTransient = false
    for (const key of TRANSIENT_RUNTIME_KEYS) {
      if (key in data) {
        hasTransient = true
        break
      }
    }
    if (!hasTransient) return node
    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!TRANSIENT_RUNTIME_KEYS.has(key)) cleaned[key] = value
    }
    return { ...node, data: cleaned }
  })
}

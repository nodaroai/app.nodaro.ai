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

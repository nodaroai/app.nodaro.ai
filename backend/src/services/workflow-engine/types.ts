/**
 * Shared types for the backend workflow execution engine.
 */

// ---------------------------------------------------------------------------
// Node execution state (stored in workflow_executions.node_states JSONB)
// ---------------------------------------------------------------------------

export interface NodeOutput {
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  text?: string
  plan?: Record<string, unknown>
  thumbnailUrl?: string
  sunoTrackId?: string
  sunoTaskId?: string
  generatedVoiceId?: string
  alignment?: unknown
  script?: unknown
  vocalUrl?: string
  instrumentalUrl?: string
  splitResults?: string[]
  combinedText?: string
  kieTaskId?: string
  paramOutputs?: Record<string, string>
  /** Accumulated results from fan-out (list/loop/split-text) execution */
  listResults?: string[]
  /** Sub-workflow output port values for handle-based routing in getPrimaryOutput */
  _outputResults?: Record<string, string>
  /** Sub-workflow visible output port ID (from routeSnapshot.visibleOutputPortId) */
  _visibleOutputPortId?: string
  /** Sub-workflow-input injected port values for handle-based routing */
  _injectedPortValues?: Record<string, string>
  /** Preview node collected upstream items */
  previewItems?: Array<{
    type: "image" | "video" | "audio" | "data" | "text"
    value: string
    sourceNodeId: string
    sourceNodeLabel: string
  }>
  /** Adjust-volume: tracks whether last input was audio or video for correct output routing */
  _lastInputType?: "audio" | "video"
  /** QA-check: whether content passed the quality check */
  approved?: boolean
  /** QA-check: explanation text */
  reason?: string
  /** QA-check: quality score 0.0-1.0 */
  score?: number
  /** Sora-character: generated character ID for use in subsequent Sora tasks */
  characterId?: string
  /** Router: list of active route IDs */
  activeRoutes?: string[]
  /** Router: route ID -> output value (undefined for inactive routes) */
  routeOutputs?: Record<string, string | undefined>
}

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export interface NodeExecutionState {
  status: NodeExecutionStatus
  nodeType?: string
  jobId?: string
  /** All job IDs from fan-out iterations (when node runs multiple times via list/loop). */
  jobIds?: string[]
  usageLogId?: string
  creditsUsed?: number
  output?: NodeOutput
  /** Resolved inputs fed to this node (stored for debugging). */
  inputs?: Record<string, unknown>
  error?: string
  startedAt?: string
  completedAt?: string
  /** Total fan-out iterations (when node runs via list/loop) */
  iterationTotal?: number
  /** Completed fan-out iterations so far */
  iterationCompleted?: number
}

// ---------------------------------------------------------------------------
// Orchestrator job data (enqueued to BullMQ)
// ---------------------------------------------------------------------------

export interface WorkflowExecutionJob {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api" | "telegram"
  triggerData?: Record<string, unknown>
  /** Optional subset of node IDs to execute (for "run from here" / "run selected"). */
  nodeIds?: string[]
  /** Presentation mode: override source node data before execution.
   *  Keys are node IDs, values are partial data to merge into node.data. */
  inputOverrides?: Record<string, Record<string, unknown>>
  /** When running a published app version, load snapshot from published_apps instead of workflows. */
  appVersionId?: string
  /** Current component nesting depth (limit 5, like sub-workflows) */
  componentDepth?: number
  /** Slugs of ancestor components in the execution chain — used for cycle detection */
  executingComponentIds?: string[]
}

// ---------------------------------------------------------------------------
// Lightweight node/edge types (no React Flow dependency)
// ---------------------------------------------------------------------------

export interface WorkflowNodeData {
  label?: string
  skipped?: boolean
  [key: string]: unknown
}

export interface SimpleNode {
  id: string
  type: string
  data: WorkflowNodeData
}

export interface SimpleEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Resolved inputs (output of input-resolver)
// ---------------------------------------------------------------------------

export interface ResolvedInputs {
  prompt?: string
  imageUrl?: string
  videoUrl?: string
  videoUrls?: string[]
  /** Video URLs with source node IDs for ordering (combine-videos) */
  videoUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>
  audioUrl?: string
  audioUrl2?: string
  audioUrls?: string[]
  /** Audio URLs with source node IDs for ordering (mix-audio) */
  audioUrlsWithSourceIds?: Array<{ nodeId: string; url: string }>
  audioSources?: Array<{
    url: string
    sourceNodeId: string
    sourceType?: "audio" | "video"
  }>
  referenceImageUrls?: string[]
  scriptData?: unknown
  dialogueLines?: Array<{ speaker: string; text: string; emotion?: string }>
  scriptCharacters?: Array<{ name: string; description: string; mood?: string; action?: string; position?: string }>
  scriptLocations?: Array<{ name: string; description: string; timeOfDay: string; weather?: string; lighting?: string }>
  sunoTrackId?: string
  sunoTaskId?: string
  uploadUrl?: string
  uploadUrlList?: string[]
  startFrameUrl?: string
  endFrameUrl?: string
  maskUrl?: string
  kieTaskId?: string
  caption?: string
  characterIdList?: string[]
}

// ---------------------------------------------------------------------------
// Execution context passed to orchestrator internals
// ---------------------------------------------------------------------------

export interface OrchestratorContext {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api" | "telegram"
  triggerData?: Record<string, unknown>
  /** Abort signal — set when execution is cancelled */
  cancelled: boolean
  /** Epoch ms of last cancel-check DB query (shared across parallel nodes to avoid duplicate queries) */
  lastCancelCheckMs?: number
  /** Workflow settings (character definitions, prompt templates) */
  workflowSettings?: Record<string, unknown>
  /** Called when a worker-queued node creates its job — allows the orchestrator
   *  to surface the jobId on nodeStates before execution completes. */
  onJobCreated?: (nodeId: string, jobId: string) => void
  /** Node IDs that have upload-* ancestors — their jobs should be force_private */
  uploadDescendantIds?: Set<string>
  /** Whether this execution is running a published app (affects free-tier app credit allowance) */
  isAppRun?: boolean
  /** Current component nesting depth (limit 5, like sub-workflows) */
  componentDepth?: number
  /** Slugs of ancestor components in the execution chain — used for cycle detection */
  executingComponentIds?: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max time for a single node to process after the worker picks it up (ms) */
export const NODE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

/** Max time for an entire workflow execution (ms) */
export const WORKFLOW_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes

/** Polling interval for checking job completion (ms) */
export const JOB_POLL_INTERVAL_MS = 3_000 // 3 seconds

/** Absolute max time a single poll loop can run, including queue wait (ms).
 *  Safety net — even if the job stays "pending" forever (worker down), we bail out. */
export const POLL_ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/** Max depth for sub-workflow nesting */
export const MAX_SUB_WORKFLOW_DEPTH = 5

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
  error?: string
  startedAt?: string
  completedAt?: string
}

// ---------------------------------------------------------------------------
// Orchestrator job data (enqueued to BullMQ)
// ---------------------------------------------------------------------------

export interface WorkflowExecutionJob {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api"
  triggerData?: Record<string, unknown>
  /** Optional subset of node IDs to execute (for "run from here" / "run selected"). */
  nodeIds?: string[]
  /** Presentation mode: override source node data before execution.
   *  Keys are node IDs, values are partial data to merge into node.data. */
  inputOverrides?: Record<string, Record<string, unknown>>
  /** When running a published app version, load snapshot from published_apps instead of workflows. */
  appVersionId?: string
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
  audioUrl?: string
  audioUrl2?: string
  audioUrls?: string[]
  audioSources?: Array<{
    url: string
    sourceNodeId: string
    sourceType?: "audio" | "video"
  }>
  referenceImageUrls?: string[]
  sunoTrackId?: string
  sunoTaskId?: string
  uploadUrl?: string
  uploadUrlList?: string[]
  startFrameUrl?: string
  endFrameUrl?: string
  maskUrl?: string
  kieTaskId?: string
}

// ---------------------------------------------------------------------------
// Execution context passed to orchestrator internals
// ---------------------------------------------------------------------------

export interface OrchestratorContext {
  executionId: string
  workflowId: string
  userId: string
  triggerType: "manual" | "webhook" | "schedule" | "api"
  triggerData?: Record<string, unknown>
  /** Abort signal — set when execution is cancelled */
  cancelled: boolean
  /** Workflow settings (character definitions, prompt templates) */
  workflowSettings?: Record<string, unknown>
  /** Called when a worker-queued node creates its job — allows the orchestrator
   *  to surface the jobId on nodeStates before execution completes. */
  onJobCreated?: (nodeId: string, jobId: string) => void
  /** Node IDs that have upload-* ancestors — their jobs should be force_private */
  uploadDescendantIds?: Set<string>
  /** Whether this execution is running a published app (affects free-tier app credit allowance) */
  isAppRun?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max time for a single node to complete (ms) */
export const NODE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

/** Max time for an entire workflow execution (ms) */
export const WORKFLOW_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes

/** Polling interval for checking job completion (ms) */
export const JOB_POLL_INTERVAL_MS = 3_000 // 3 seconds

/** Max depth for sub-workflow nesting */
export const MAX_SUB_WORKFLOW_DEPTH = 5

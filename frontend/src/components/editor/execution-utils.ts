import { tx, type MessageKey } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import { NODE_DEFINITIONS } from "@/types/nodes"

export const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  running: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400",
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  stopping: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  // Discard = stopped the flow, in-flight jobs finished into My Library but
  // detached from the canvas. Distinct (muted grey) from cancelled's orange.
  discarded: "bg-gray-200 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
  timed_out: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
}

/** Execution and job status ids, captioned in the interface language. */
const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  running: "exec.statusRunning",
  completed: "exec.statusCompleted",
  failed: "exec.statusFailed",
  pending: "exec.statusPending",
  cancelled: "exec.statusCancelled",
  discarded: "exec.statusDiscarded",
  stopping: "exec.statusStopping",
  timed_out: "exec.statusTimedOut",
  skipped: "exec.statusSkipped",
  processing: "exec.statusProcessing",
  queued: "node.queued",
}

/** A status badge's text; a status with no caption passes through. */
export function statusLabel(status: string): string {
  return Object.hasOwn(STATUS_KEYS, status) ? tx(STATUS_KEYS[status]) : status
}

export const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  webhook: "Webhook",
  schedule: "Schedule",
  "single-node": "Single Node",
  app_run: "App Run",
  mcp: "via MCP",
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  // Same dictionary keys as formatRelative() (English is unchanged: "5m ago").
  if (diffSecs < 60) return tx("time.justNow")
  if (diffMins < 60) return tx("time.minAgo", { n: diffMins })
  if (diffHours < 24) return tx("time.hrAgo", { n: diffHours })
  if (diffDays < 7) return tx("time.dayAgo", { n: diffDays })
  return formatDate(date)
}

export function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt) return "-"
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = (end - start) / 1000
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

export const NODE_STATUS_DOT: Record<string, string> = {
  completed: "bg-green-500",
  failed: "bg-red-500",
  running: "bg-yellow-500 animate-pulse",
  pending: "bg-blue-400",
  skipped: "bg-gray-400",
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  "generate-image": "Image Generation",
  "image-to-image": "Image to Image",
  "edit-image": "Image Editing",
  "image-edit": "Manual Image Edit",
  "image-to-video": "Image to Video",
  "text-to-video": "Text to Video",
  "video-to-video": "Video to Video",
  "text-to-speech": "Text to Speech",
  "text-to-dialogue": "Dialogue",
  "generate-music": "Music Generation",
  "text-to-audio": "Sound Effects",
  "generate-script": "Script Generation",
  "ai-writer": "AI Writer",
  "llm-chat": "Generate Text - Any LLM",
  "video-composer": "Video Composer",
  "after-effects": "After Effects",
  "lottie-overlay": "Lottie Overlay",
  "3d-title": "3D Title",
  "generate-3d-scene": "Generate 3D Scene",
  "pro-3d-render": "3D Render Pro",
  "edit-3d-scene": "Edit 3D Scene",
  "motion-graphics": "Motion Graphics",
  "render-video": "Video Render",
  "voice-changer": "Voice Changer",
  "voice-changer-pro": "Voice Changer Pro",
  "voice-design": "Voice Design",
  "voice-remix": "Voice Remix",
  "dubbing": "Dubbing",
  "forced-alignment": "Forced Alignment",
  "audio-isolation": "Audio Isolation",
  "lip-sync": "Lip Sync",
  "motion-transfer": "Motion Transfer",
  "video-upscale": "Upscale Video",
  "video-depth": "Video Depth",
  "image-to-text": "Image to Text",
  "video-analysis": "Video Analysis",
  "video-audit": "AI Audit",
  "describe-to-picker": "Describe to Picker",
  "qa-check": "QA Check",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video+Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "trim-video": "Trim Video",
  "trim-audio": "Trim Audio",
  "speed-ramp": "Speed Ramp",
  "loop-video": "Loop Video",
  "fade-video": "Fade Video",
  "mask-composite": "Mask Composite",
  "video-mask": "Video Mask",
  "video-overlay": "Video Overlay",
  "ugc-clip": "UGC Clip",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "pitch-tempo": "Pitch & Tempo",
  "translate": "Translation",
  "component": "Component",
}

/** Every node type's own name (its `NODE_DEFINITIONS` label) — the fallback for
 *  a type the job-label table above does not name, so a new node reads by its
 *  name rather than as its id title-cased. */
const DEFINITION_LABELS: ReadonlyMap<string, string> = new Map(NODE_DEFINITIONS.map((d) => [d.type, d.label]))

export function formatNodeType(nodeType: string): string {
  return JOB_TYPE_LABELS[nodeType] ?? DEFINITION_LABELS.get(nodeType) ?? nodeType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface NodeState {
  status: string
  nodeType?: string
  jobId?: string
  /** All job IDs from fan-out iterations (list/loop). */
  jobIds?: string[]
  /** A failed all-or-nothing fan-out (UGC Clip): the row each of `jobIds` ran (from 0), index-aligned with it. */
  jobRows?: number[]
  creditsUsed?: number
  /** Node output (videoUrl, imageUrl, audioUrl, text, etc.) */
  output?: Record<string, unknown>
  /** Resolved inputs fed to this node (for debugging). */
  inputs?: Record<string, unknown>
  error?: string
  /** Why the RUN skipped this node (`empty_input`); absent on a router-gated one. */
  skipReason?: string
  startedAt?: string
  completedAt?: string
}

/** One fan-out iteration's sub-row under its node: its key, its label and the state it opens. */
export interface FanOutSubRow {
  readonly key: string
  readonly label: { readonly key: MessageKey; readonly n: number }
  readonly state: NodeState
}

/**
 * How a node's row in a run's history lays out its fan-out: whether it has sub-rows, whether its
 * own row opens (its job), and each sub-row. A node that ran more than once has a sub-row per job,
 * and its own row is only their total. A FAILED all-or-nothing node (UGC Clip) keeps its own row,
 * which opens the failure, with a sub-row for each item it finished: each opens that item's job
 * as completed (never the node's error), labelled by the row it ran — a UGC Clip's row is its clip
 * — in row order. Pure.
 */
export function fanOutSubRows(nodeId: string, state: NodeState): { readonly hasFanOut: boolean; readonly ownRowOpens: boolean; readonly rows: readonly FanOutSubRow[] } {
  const jobs = state.jobIds ?? []
  const failed = state.status === "failed"
  const hasFanOut = jobs.length > 1 || (failed && jobs.length > 0)
  if (!hasFanOut) return { hasFanOut: false, ownRowOpens: true, rows: [] }
  const rowsKnown = Array.isArray(state.jobRows) && state.jobRows.length === jobs.length && state.jobRows.every((r) => Number.isInteger(r) && r >= 0)
  const labelKey: MessageKey = rowsKnown && state.nodeType === "ugc-clip" ? "exec.clipRow" : "exec.iteration"
  const entries = jobs.map((jobId, idx) => ({ jobId, idx, n: (rowsKnown ? state.jobRows![idx]! : idx) + 1 }))
  if (rowsKnown) entries.sort((a, b) => a.n - b.n)
  const rows = entries.map(({ jobId, idx, n }) => {
    const { jobIds: _jobs, jobRows: _rows, ...own } = state
    // A finished item of a failed node is a finished job: it opens as one, without the node's error.
    const opened: NodeState = failed ? { ...own, status: "completed", error: undefined, jobId } : { ...own, jobId }
    return { key: `${nodeId}-iter-${idx}`, label: { key: labelKey, n }, state: opened }
  })
  return { hasFanOut: true, ownRowOpens: failed, rows }
}

/**
 * The node rows a run's history shows: what actually ran, plus a node the RUN
 * skipped for a reason (`skipReason` — "nothing new" is a verdict worth a
 * row). Router-gated skips and pre-completed source nodes stay out, as before.
 */
export function isExecutedNodeEntry(state: Pick<NodeState, "status" | "startedAt" | "skipReason">): boolean {
  if (state.status === "skipped") return !!state.skipReason
  return !(state.status === "completed" && !state.startedAt)
}

const SKIP_REASON_KEYS: Record<string, MessageKey> = {
  empty_input: "exec.skipReasonEmptyInput",
}

/** A skip reason's caption; an unknown reason passes through. */
export function skipReasonLabel(reason: string): string {
  const key = SKIP_REASON_KEYS[reason]
  return key ? tx(key) : reason
}

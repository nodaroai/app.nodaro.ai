/**
 * One reading of a run's node states for every machine client — the API
 * token's `/v1/api/result`, MCP `get_app_run` and `diagnose_run`: what each
 * node produced (its text, every media URL), what it was skipped for, what
 * failed, and how the run as a whole ended (`outcome`). Lifted from
 * api-tokens.ts so the three surfaces cannot drift apart.
 */
import { executionOutcome, getNodeLabel, getOutputNodes, getOutputType, type GenericEdge, type GenericNode } from "@nodaro/shared"
import { normalizeLegacyNodeTypes } from "../services/workflow-engine/normalize-node-types.js"
import type { NodeExecutionState, NodeOutput } from "../services/workflow-engine/types.js"

export interface NodeMediaRef {
  readonly kind: "image" | "video" | "audio"
  readonly url: string
}

export interface NodeStateSummary {
  readonly nodeId: string
  readonly label: string
  readonly nodeType: string | null
  readonly status: string
  readonly skipReason?: string
  readonly error?: string
  readonly jobId?: string
  /** The node's text output, cut at `textLimit` characters. */
  readonly text?: string
  readonly textTruncated?: boolean
  /** Every media URL the node produced, in output order, cut at `mediaLimit`. */
  readonly media: NodeMediaRef[]
}

export interface SummarizeOptions {
  readonly textLimit?: number
  readonly mediaLimit?: number
}

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v)

function kindOfUrl(url: string): NodeMediaRef["kind"] | null {
  const lower = url.toLowerCase().split("?")[0]!
  if (/\.(jpe?g|png|gif|webp|svg|bmp|avif|heic|heif)$/.test(lower)) return "image"
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return "video"
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(lower)) return "audio"
  return null
}

/** Every media URL a node output carries, each once, typed by the field it came from. */
export function mediaOfOutput(output: NodeOutput | undefined): NodeMediaRef[] {
  if (!output) return []
  const out: NodeMediaRef[] = []
  const seen = new Set<string>()
  const push = (kind: NodeMediaRef["kind"] | null, url: unknown) => {
    if (!isUrl(url) || seen.has(url)) return
    const k = kind ?? kindOfUrl(url)
    if (!k) return
    seen.add(url)
    out.push({ kind: k, url })
  }
  push("image", output.imageUrl)
  for (const u of output.imageUrls ?? []) push("image", u)
  push("image", output.maskUrl)
  for (const v of output.variants ?? []) push("image", v.url)
  push("video", output.videoUrl)
  push("audio", output.audioUrl)
  for (const u of output.audioUrls ?? []) push("audio", u)
  for (const u of [output.vocalUrl, output.instrumentalUrl, output.drumsUrl, output.bassUrl, output.otherUrl, output.guitarUrl, output.pianoUrl]) push("audio", u)
  for (const t of output.sunoTracks ?? []) {
    push("audio", t.audioUrl)
    push("image", t.imageUrl)
  }
  // A fan-out's per-iteration results: URLs when the node produced media.
  for (const r of output.listResults ?? []) push(null, r)
  return out
}

function textOfOutput(output: NodeOutput | undefined): string | undefined {
  if (!output) return undefined
  const candidates = [output.text, output.result, output.extractedText, output.combinedText]
  const text = candidates.find((c): c is string => typeof c === "string" && c.trim().length > 0)
  if (text !== undefined) return text
  if (typeof output.script === "string") return output.script
  return undefined
}

/** Per-node summaries in the workflow's node order (states for nodes not in the graph follow, by id). */
export function summarizeNodeStates(
  nodeStates: Readonly<Record<string, NodeExecutionState>>,
  workflowNodes?: ReadonlyArray<GenericNode>,
  { textLimit = 1500, mediaLimit = 20 }: SummarizeOptions = {},
): NodeStateSummary[] {
  const byId = new Map((workflowNodes ?? []).map((n) => [n.id, n] as const))
  const ordered = [
    ...(workflowNodes ?? []).map((n) => n.id).filter((id) => id in nodeStates),
    ...Object.keys(nodeStates).filter((id) => !byId.has(id)),
  ]
  return ordered.map((nodeId) => {
    const state = nodeStates[nodeId]!
    const node = byId.get(nodeId)
    const fullText = textOfOutput(state.output)
    const text = fullText !== undefined && fullText.length > textLimit ? fullText.slice(0, textLimit) : fullText
    const media = mediaOfOutput(state.output).slice(0, mediaLimit)
    return {
      nodeId,
      label: node ? getNodeLabel(node) : (state.nodeType ?? nodeId),
      nodeType: node?.type ?? state.nodeType ?? null,
      status: state.status,
      ...(state.skipReason ? { skipReason: state.skipReason } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(state.jobId ? { jobId: state.jobId } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(fullText !== undefined && text !== fullText ? { textTruncated: true } : {}),
      media,
    }
  })
}

export interface ExecutionResultShape {
  executionId: string
  status: unknown
  /** How a completed run ended; absent until it completes. */
  outcome?: "succeeded" | "nothing_new"
  creditsUsed: unknown
  durationMs: number | undefined
  errorMessage: unknown
  outputs: Array<{ nodeId: string; label: string; type: string; url?: string; text?: string }>
}

/**
 * The API token's result shape (`/v1/api/result/:execId`, the sync `?wait`
 * answer): the OUTPUT nodes' first url or text each, plus the run's outcome.
 */
export function formatExecutionResult(
  executionId: string,
  execution: Record<string, unknown>,
  workflowNodes: GenericNode[],
): ExecutionResultShape {
  const nodeStates = (execution.node_states ?? {}) as Record<string, NodeExecutionState>
  const edges: GenericEdge[] = []
  const outputNodes = getOutputNodes(normalizeLegacyNodeTypes(workflowNodes), edges, false)
  const outputs: ExecutionResultShape["outputs"] = []
  for (const node of outputNodes) {
    const state = nodeStates[node.id]
    if (!state || state.status !== "completed") continue
    const output = state.output
    if (!output) continue
    const url = output.imageUrl ?? output.videoUrl ?? output.audioUrl
    const text = (output.text ?? output.script) as string | undefined
    outputs.push({
      nodeId: node.id,
      label: getNodeLabel(node),
      type: getOutputType(node.type),
      url: url ?? undefined,
      text: text ?? undefined,
    })
  }
  const durationMs =
    execution.completed_at && execution.created_at
      ? new Date(execution.completed_at as string).getTime() - new Date(execution.created_at as string).getTime()
      : undefined
  const outcome = executionOutcome(execution.status, nodeStates)
  return {
    executionId,
    status: execution.status,
    ...(outcome ? { outcome } : {}),
    creditsUsed: execution.total_credits_used ?? 0,
    durationMs,
    errorMessage: execution.error_message,
    outputs,
  }
}

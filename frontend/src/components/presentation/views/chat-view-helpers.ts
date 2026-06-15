import { getParameterValue } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { ORIGINAL_SLOT_ID, type RunSlot, type RunSlotNodeState } from "@/components/app-runner/types"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"
import { getNodeLabel } from "@/lib/presentation-utils"
import { isMultiColumnList } from "@/lib/list-loop-migration"
import { deriveSingleColumnListItems } from "../helpers"

const UPLOAD_TYPES = new Set(["upload-image", "upload-video", "upload-audio"])
export const isUploadNode = (type?: string) => UPLOAD_TYPES.has(type ?? "")

/** First media/result URL on an output payload (covers every provider's field name). */
export function outputUrl(out: Record<string, unknown> | undefined): string | undefined {
  if (!out) return undefined
  return (out.imageUrl ?? out.videoUrl ?? out.audioUrl ?? out.url ?? out.resultUrl) as string | undefined
}

/** First non-empty string field of an input-value bag (fallback chip label). */
export function firstStringValue(v: Record<string, unknown> | undefined): string | undefined {
  if (!v) return undefined
  for (const val of Object.values(v)) {
    if (typeof val === "string" && val.trim()) return val.trim()
  }
  return undefined
}

/** Count of populated rows/items for a list node (shares the single-column
 * derivation with areAllInputsFilled — see deriveSingleColumnListItems). */
function countListItems(data: Record<string, unknown>, inputVals: Record<string, unknown> | undefined): number {
  if (isMultiColumnList(data)) {
    const rows = (inputVals?.rows as string[][] | undefined) ?? (data.rows as string[][]) ?? []
    return rows.length
  }
  return deriveSingleColumnListItems(data, inputVals).length
}

/**
 * Short display string for a composer chip — `undefined` means "empty / show
 * the bare label". Uploads return undefined (the chip renders a thumbnail from
 * `inputValues[id].url` itself); lists summarise as "N items"; parameter nodes
 * resolve through the typed `getParameterValue` (with a first-string fallback).
 */
export function getChipValue(
  node: WorkflowNode,
  inputValues: Record<string, Record<string, unknown>>,
): string | undefined {
  const type = node.type ?? ""
  const inputVals = inputValues[node.id]
  const data = (node.data ?? {}) as Record<string, unknown>

  if (type === "text-prompt") {
    return (((inputVals?.text as string) ?? (data.text as string) ?? "").trim()) || undefined
  }
  if (isUploadNode(type)) return undefined
  if (type === "list") {
    const n = countListItems(data, inputVals)
    return n > 0 ? `${n} item${n === 1 ? "" : "s"}` : undefined
  }
  const merged = { ...data, ...(inputVals ?? {}) }
  return getParameterValue(merged, type)?.trim() || firstStringValue(inputVals) || undefined
}

/**
 * Resolve a node's media/text for a FROZEN run slot (used by the chat result
 * viewer). Outputs win over inputs: a completed output payload, else the run's
 * submitted input value.
 */
export function resolveSlotResult(slot: RunSlot, nodeId: string): { url?: string; text?: string } {
  const out = slot.nodeStates[nodeId]?.output
  if (out) return { url: outputUrl(out), text: out.text as string | undefined }
  const iv = slot.inputValues[nodeId]
  return { url: iv?.url as string | undefined, text: iv?.text as string | undefined }
}

export interface ThreadMessage {
  slot: RunSlot
  isOriginal: boolean
}

function originalHasOutput(s: RunSlot): boolean {
  return Object.values(s.nodeStates).some((st) => st.status === "completed" && !!st.output)
}

/**
 * Thread order: the Original/demo slot first (only if it carries demo output),
 * then launched (non-idle) user slots oldest→newest. Idle drafts are excluded
 * — the active idle draft IS the composer, not a message.
 *
 * `slots` arrives as `[original, ...userNewestFirst]` (use-run-slots ordering).
 */
export function getThreadMessages(slots: RunSlot[]): ThreadMessage[] {
  const original = slots.find((s) => s.id === ORIGINAL_SLOT_ID)
  const userNewestFirst = slots.filter((s) => s.id !== ORIGINAL_SLOT_ID && s.executionStatus !== "idle")
  const oldestFirst = [...userNewestFirst].reverse()
  const out: ThreadMessage[] = []
  if (original && originalHasOutput(original)) out.push({ slot: original, isOriginal: true })
  for (const s of oldestFirst) out.push({ slot: s, isOriginal: false })
  return out
}

export interface StepChip {
  nodeId: string
  label: string
  status: RunSlotNodeState["status"]
}

/**
 * Step chips for a run message: the deduped, topologically-ordered union of
 * executable ancestors-or-self of the output nodes. Not a naive snapshot-order
 * chain — progress segments branch per output, and node insertion order is not
 * topological, so we walk ancestors, dedupe, filter to executable nodes, then
 * Kahn-sort (tie-broken by node array index for stable display).
 */
export function buildStepChips(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  outputNodeIds: string[],
  nodeStates: Record<string, RunSlotNodeState>,
): StepChip[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  // Reverse adjacency: target → its sources.
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    if (!parents.has(e.target)) parents.set(e.target, [])
    parents.get(e.target)!.push(e.source)
  }

  // Collect ancestors-or-self of every output node (dedupe via the set).
  const inSet = new Set<string>()
  const stack = [...outputNodeIds]
  while (stack.length) {
    const id = stack.pop()!
    if (inSet.has(id)) continue
    inSet.add(id)
    for (const p of parents.get(id) ?? []) stack.push(p)
  }

  // Keep only nodes that exist and are executable (drops inputs/parameter pickers).
  const stepIds = [...inSet].filter((id) => {
    const n = byId.get(id)
    return !!n && isExecutableNode(n)
  })
  const stepSet = new Set(stepIds)

  // Kahn topological sort restricted to the step set; tie-break by node index.
  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  const indeg = new Map(stepIds.map((id) => [id, 0]))
  const children = new Map<string, string[]>()
  for (const e of edges) {
    if (stepSet.has(e.source) && stepSet.has(e.target)) {
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
      if (!children.has(e.source)) children.set(e.source, [])
      children.get(e.source)!.push(e.target)
    }
  }
  const byIdx = (a: string, b: string) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0)
  const ready = stepIds.filter((id) => (indeg.get(id) ?? 0) === 0).sort(byIdx)
  const ordered: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    ordered.push(id)
    for (const c of children.get(id) ?? []) {
      indeg.set(c, (indeg.get(c) ?? 0) - 1)
      if ((indeg.get(c) ?? 0) === 0) {
        ready.push(c)
        ready.sort(byIdx)
      }
    }
  }

  return ordered.map((id) => ({
    nodeId: id,
    label: getNodeLabel(byId.get(id)!),
    status: nodeStates[id]?.status ?? "pending",
  }))
}


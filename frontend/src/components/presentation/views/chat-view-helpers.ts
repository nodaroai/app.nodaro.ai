import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { ORIGINAL_SLOT_ID, type RunSlot, type RunSlotNodeState } from "@/components/app-runner/types"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"
import { getNodeLabel } from "@/lib/presentation-utils"
import { isParameterPickerNode } from "@/lib/parameter-picker-types"

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

const TALL_INPUT_TYPES = new Set(["list", "ai-avatar", "cinematic-avatar"])

/**
 * Adaptive composer default (design decision B): start expanded when the app has
 * any tall/multi-field input (loop table, parameter picker, avatar) or more than
 * two curated inputs; otherwise start collapsed (compact bar).
 */
export function shouldExpandComposer(inputNodes: WorkflowNode[]): boolean {
  if (inputNodes.length > 2) return true
  return inputNodes.some((n) => TALL_INPUT_TYPES.has(n.type ?? "") || isParameterPickerNode(n.type))
}

export interface MessageSummary {
  label: string
  inputCount: number
  creditsUsed: number
}

/** Left-side summary for a message: first non-empty text input as the label. */
export function getMessageSummary(slot: RunSlot, inputNodes: WorkflowNode[]): MessageSummary {
  let label = ""
  for (const n of inputNodes) {
    const text = (slot.inputValues[n.id]?.text as string) ?? ""
    if (text.trim()) {
      label = text.trim()
      break
    }
  }
  if (!label) label = slot.name?.trim() || "Run"
  return { label, inputCount: inputNodes.length, creditsUsed: slot.creditsUsed }
}

import type { WorkflowNode } from "@/types/nodes"

export interface RunSlotNodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: Record<string, unknown>
  error?: string
}

export interface RunSlot {
  id: string
  name: string | null
  inputValues: Record<string, Record<string, unknown>>
  nodeStates: Record<string, RunSlotNodeState>
  executionId: string | null
  executionStatus: "idle" | "running" | "completed" | "failed"
  completedNodes: number
  totalNodes: number
  creditsUsed: number
  createdAt: number
  version: number | null
  thumbnailUrl: string | null
}

export function makeEmptyInputs(inputNodes: WorkflowNode[]): Record<string, Record<string, unknown>> {
  const empty: Record<string, Record<string, unknown>> = {}
  for (const node of inputNodes) {
    const t = node.type ?? ""
    if (t === "text-prompt") empty[node.id] = { text: "" }
    else if (t === "upload-image" || t === "upload-video" || t === "upload-audio") empty[node.id] = { url: "" }
  }
  return empty
}

export function toSlotStatus(s: string): RunSlot["executionStatus"] {
  if (s === "loading" || s === "running") return "running"
  if (s === "completed") return "completed"
  if (s === "failed") return "failed"
  return "idle"
}

export function dbStatusToSlotStatus(s: string): RunSlot["executionStatus"] {
  if (s === "running" || s === "pending") return "running"
  if (s === "completed") return "completed"
  if (s === "failed" || s === "cancelled") return "failed"
  return "idle" // "draft"
}

export function isMediaUrl(url: string): "image" | "video" | null {
  const lower = url.toLowerCase()
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?|$)/.test(lower)) return "image"
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/.test(lower)) return "video"
  return null
}

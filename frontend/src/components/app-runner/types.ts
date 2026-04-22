import type { WorkflowNode } from "@/types/nodes"
import { getNodeResult, getOutputType } from "@/lib/presentation-utils"

export const ORIGINAL_SLOT_ID = "original"

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
  hiddenNodes?: string[]
}

export function makeEmptyInputs(inputNodes: WorkflowNode[]): Record<string, Record<string, unknown>> {
  const empty: Record<string, Record<string, unknown>> = {}
  for (const node of inputNodes) {
    const t = node.type ?? ""
    const d = node.data as Record<string, unknown>
    if (t === "text-prompt") {
      // Preserve the original value for readonly prompts — they can't be edited
      empty[node.id] = { text: d.presentationReadOnly ? (d.text as string) ?? "" : "" }
    } else if (t === "upload-image" || t === "upload-video" || t === "upload-audio") empty[node.id] = { url: "" }
    else if (t === "list") {
      empty[node.id] = { items: [""] }
    } else if (t === "loop") {
      const columns = (d.columns as Array<Record<string, unknown>>) ?? []
      const minRows = (d.minRows as number) ?? 0
      const defaultRows = Math.max((d.defaultRows as number) ?? 1, minRows)
      const emptyRow = columns.map(() => "")
      empty[node.id] = { rows: Array.from({ length: defaultRows }, () => [...emptyRow]) }
    }
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

/**
 * Build input values from published snapshot nodes (the demo values captured at publish time).
 */
export function makeSnapshotInputs(inputNodes: WorkflowNode[]): Record<string, Record<string, unknown>> {
  const inputs: Record<string, Record<string, unknown>> = {}
  for (const node of inputNodes) {
    const t = node.type ?? ""
    if (t === "text-prompt") {
      inputs[node.id] = { text: (node.data.text as string) ?? "" }
    } else if (t === "upload-image" || t === "upload-video" || t === "upload-audio") {
      inputs[node.id] = { url: (node.data.url as string) ?? "" }
    } else if (t === "list") {
      const d = node.data as Record<string, unknown>
      let items: string[] = []
      // Modern format (columns+rows) wins — otherwise published apps with
      // modern lists loaded with default empty values instead of their
      // snapshot data.
      if (d.columns) {
        const rows = (d.rows as string[][] | undefined) ?? []
        items = rows.map((r) => r[0]?.trim() ?? "").filter(Boolean)
      } else {
        const raw = d.items
        if (Array.isArray(raw)) {
          items = raw.map(String).filter(Boolean)
        } else {
          items = (String(raw || "")).split("\n").map((s: string) => s.trim()).filter(Boolean)
        }
      }
      inputs[node.id] = { items: items.length > 0 ? items : [""] }
    } else if (t === "loop") {
      const loopData = node.data as Record<string, unknown>
      const rows = (loopData.rows as string[][]) ?? []
      const columns = (loopData.columns as Array<Record<string, unknown>>) ?? []
      inputs[node.id] = { rows: rows.length > 0 ? rows : [columns.map(() => "")] }
    }
  }
  return inputs
}

/**
 * Build node states from published snapshot output nodes (completed results captured at publish time).
 */
export function makeSnapshotNodeStates(outputNodes: WorkflowNode[]): Record<string, RunSlotNodeState> {
  const states: Record<string, RunSlotNodeState> = {}
  for (const node of outputNodes) {
    const result = getNodeResult(node.data as Record<string, unknown>)
    if (result.url || result.text) {
      // getFullscreenResult expects typed keys (imageUrl/videoUrl/audioUrl), not generic "url"
      const output: Record<string, unknown> = {}
      if (result.url) {
        const outputType = getOutputType(node.type)
        if (outputType === "image") output.imageUrl = result.url
        else if (outputType === "video") output.videoUrl = result.url
        else if (outputType === "audio") output.audioUrl = result.url
        else output.imageUrl = result.url // fallback
      }
      if (result.text) output.text = result.text
      states[node.id] = { status: "completed", output }
    }
  }
  return states
}

export function isMediaUrl(url: string): "image" | "video" | null {
  const lower = url.toLowerCase()
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|heic|heif)(\?|$)/.test(lower)) return "image"
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/.test(lower)) return "video"
  return null
}

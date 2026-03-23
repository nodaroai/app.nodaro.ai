import type { WorkflowNode } from "@/types/nodes"
import { getNodeLabel, getNodeResult } from "@/lib/presentation-utils"

/** Get display title for a presentation card — custom title from cardMeta, or fallback to node label */
export function getCardTitle(
  node: WorkflowNode,
  cardMeta: Record<string, { title?: string; description?: string }> | undefined,
): string {
  return cardMeta?.[node.id]?.title || getNodeLabel(node)
}

/** Reorder nodes by an ID array, appending any new nodes at the end */
export function orderNodesByIds(nodes: WorkflowNode[], order: string[] | undefined): WorkflowNode[] {
  if (!order || order.length === 0) return nodes
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const ordered: WorkflowNode[] = []
  for (const id of order) {
    const node = nodeMap.get(id)
    if (node) {
      ordered.push(node)
      nodeMap.delete(id)
    }
  }
  for (const node of nodeMap.values()) ordered.push(node)
  return ordered
}

/** getNodeResult that also checks input node data fields (url, text) */
export function getNodeResultWithInputFallback(node: WorkflowNode): { url?: string; text?: string } {
  const data = node.data as Record<string, unknown>
  const result = getNodeResult(data)
  if (result.url || result.text) return result

  // Loop/table node: extract first media URL from rows
  if (node.type === "loop") {
    const loopResult = getLoopFirstMedia(data)
    if (loopResult.url || loopResult.text) return loopResult
  }

  const url = data.url as string | undefined
  const text = data.text as string | undefined
  return { url: url || undefined, text: text || undefined }
}

/** Extract the first media URL (or text) from a loop node's table data */
export function getLoopFirstMedia(
  data: Record<string, unknown>,
  overrideRows?: string[][],
): { url?: string; text?: string } {
  const columns = (data.columns as Array<{ type?: string }>) ?? []
  const rows = overrideRows ?? (data.rows as string[][]) ?? []
  if (rows.length === 0 || columns.length === 0) return {}
  // Prefer first media column
  for (let ci = 0; ci < columns.length; ci++) {
    const colType = columns[ci]?.type ?? "text"
    if (colType !== "text") {
      const url = rows[0]?.[ci]
      if (url) return { url }
    }
  }
  // Fall back to first text column
  for (let ci = 0; ci < columns.length; ci++) {
    if ((columns[ci]?.type ?? "text") === "text") {
      const text = rows[0]?.[ci]
      if (text) return { text }
    }
  }
  return {}
}

/** Check if all required inputs are filled (text-prompt needs text, upload nodes need URL) */
export function areAllInputsFilled(
  inputNodes: WorkflowNode[],
  inputValues: Record<string, Record<string, unknown>>,
): boolean {
  for (const node of inputNodes) {
    const data = node.data as Record<string, unknown>
    const nodeType = node.type ?? ""
    const inputVals = inputValues[node.id] as Record<string, unknown> | undefined
    if (nodeType === "text-prompt") {
      const text = (inputVals?.text as string) ?? (data.text as string) ?? ""
      if (!text.trim()) return false
    } else if (nodeType === "upload-image" || nodeType === "upload-video" || nodeType === "upload-audio") {
      const url = (inputVals?.url as string) ?? (data.url as string) ?? ""
      if (!url) return false
    } else if (nodeType === "list") {
      const items = (inputVals?.items as string[] | undefined)
        ?? ((data.items as string) || "").split("\n").map((s: string) => s.trim()).filter(Boolean)
      if (!Array.isArray(items) || items.length === 0 || items.every((s: string) => !String(s).trim())) return false
    } else if (nodeType === "loop") {
      const columns = (data.columns as Array<{ type?: string }>) ?? []
      const rows = (inputVals?.rows as string[][] | undefined) ?? (data.rows as string[][]) ?? []
      const minRows = (data.minRows as number) ?? 0
      if (rows.length < minRows) return false
      if (rows.length === 0) continue
      for (const row of rows) {
        for (let i = 0; i < columns.length; i++) {
          if (!(row[i]?.trim())) return false
        }
      }
    }
  }
  return true
}

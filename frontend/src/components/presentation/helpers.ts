import type { WorkflowNode } from "@/types/nodes"
import { NODE_DEF_MAP } from "@/types/nodes"
import type { ExposableField, PresentationItem } from "@nodaro/shared"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import { getNodeLabel, getNodeResult } from "@/lib/presentation-utils"
import { migrateToItems, deriveLottieSlotFields, LOTTIE_SLOT_FIELD_PREFIX } from "@nodaro/shared"
import { isMultiColumnList } from "@/lib/list-loop-migration"

/** Resolve input items from settings — prefer inputItems, fallback to migrated inputOrder */
export function resolveInputItems(settings: PresentationSettings): PresentationItem[] | null {
  if (settings.inputItems) return settings.inputItems
  if (settings.inputOrder) return migrateToItems(settings.inputOrder) ?? null
  return null
}

/** Resolve output items from settings — prefer outputItems, fallback to migrated outputOrder */
export function resolveOutputItems(settings: PresentationSettings): PresentationItem[] | null {
  if (settings.outputItems) return settings.outputItems
  if (settings.outputOrder) return migrateToItems(settings.outputOrder) ?? null
  return null
}

/**
 * Resolve the `ExposableField` descriptor for a node + field key — the single
 * source of truth shared by the publish picker, the presentation runtime, and
 * the app-runner runtime.
 *
 * Static fields come from `NODE_DEFINITIONS`. `slot:<sid>` fields on a
 * motion-graphics node carrying a lottie-graphic plan are derived dynamically
 * from the plan's slot manifest via `deriveLottieSlotFields` (the same shared
 * helper the editor's live slot controls and the backend MCP schema extractor
 * use), so the exposed-slot set can never drift between surfaces. The derived
 * descriptors are ExposableField-shaped (their `color`/`text`/`slider` types are
 * all members of `ExposableField["type"]`).
 */
export function findExposableField(
  node: WorkflowNode | undefined,
  fieldKey: string,
): ExposableField | undefined {
  if (!node?.type) return undefined
  const def = NODE_DEF_MAP.get(node.type)
  const staticField = def?.exposableFields?.find((f) => f.key === fieldKey)
  if (staticField) return staticField
  if (fieldKey.startsWith(LOTTIE_SLOT_FIELD_PREFIX)) {
    const motionPlan = (node.data as Record<string, unknown> | undefined)?.motionPlan as
      | Record<string, unknown>
      | undefined
    const slot = deriveLottieSlotFields(motionPlan).find((f) => f.key === fieldKey)
    if (slot) return slot as ExposableField
  }
  return undefined
}

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

  // List/table node (loop→list-unified): extract first media URL from rows
  if (node.type === "list") {
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
      // "Filled" check by column count (see isMultiColumnList): multi-column
      // validates the `rows` grid, single-column validates `items`.
      if (isMultiColumnList(data)) {
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
      } else {
        // Modern format (columns+rows) wins, legacy items string is fallback.
        // Otherwise modern lists with populated rows were reported as "empty"
        // and the run button stayed disabled.
        let items: string[]
        if (inputVals?.items) {
          items = inputVals.items as string[]
        } else if (data.columns) {
          const rows = (data.rows as string[][] | undefined) ?? []
          items = rows.map((r) => r[0]?.trim() ?? "").filter(Boolean)
        } else {
          items = ((data.items as string) || "").split("\n").map((s: string) => s.trim()).filter(Boolean)
        }
        if (!Array.isArray(items) || items.length === 0 || items.every((s: string) => !String(s).trim())) return false
      }
    }
  }
  return true
}

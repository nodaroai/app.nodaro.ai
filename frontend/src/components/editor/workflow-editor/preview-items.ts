import type { PreviewItem, PreviewNodeData, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { buildPreviewItemKey, getPreviewItemKey } from "@/lib/preview-items"
import { detectPreviewItemType, extractNodeOutput } from "./execution-graph"

export function buildPreviewFingerprint(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId)
  return incomingEdges.map((edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source)
    const sourceHandle = edge.sourceHandle ?? undefined
    const itemKey = buildPreviewItemKey(edge.source, sourceHandle)
    const output = sourceNode ? extractNodeOutput(sourceNode, sourceHandle) ?? "" : ""
    return `${itemKey}:${output}`
  }).join("||")
}

export function collectPreviewItems(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  prevData: Pick<PreviewNodeData, "previewItems" | "itemOrder">,
): {
  ordered: PreviewItem[]
  itemOrder: string[]
} {
  const prevVisibility = new Map<string, boolean>()
  for (const item of prevData.previewItems ?? []) {
    prevVisibility.set(getPreviewItemKey(item), item.visible)
  }
  const prevOrder = prevData.itemOrder ?? []

  const incomingEdges = edges.filter((edge) => edge.target === nodeId)
  const freshItems: PreviewItem[] = []

  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode) continue

    const sourceHandle = edge.sourceHandle ?? undefined
    const raw = extractNodeOutput(sourceNode, sourceHandle)
    const trimmed = raw?.trim()
    if (!trimmed) continue

    const srcType = sourceNode.type ?? ""
    const srcLabel = ((sourceNode.data as Record<string, unknown>).label as string) || srcType
    const itemKey = buildPreviewItemKey(sourceNode.id, sourceHandle)
    const itemType = detectPreviewItemType(srcType, trimmed, sourceHandle)

    freshItems.push({
      type: itemType,
      value: trimmed,
      itemKey,
      sourceNodeId: sourceNode.id,
      sourceHandle,
      sourceNodeLabel: srcLabel,
      visible: prevVisibility.get(itemKey) ?? true,
    })
  }

  const itemMap = new Map(freshItems.map((item) => [getPreviewItemKey(item), item]))
  const ordered: PreviewItem[] = []
  for (const persistedKey of prevOrder) {
    const itemKey = itemMap.has(persistedKey)
      ? persistedKey
      : (persistedKey.includes(":") ? persistedKey : buildPreviewItemKey(persistedKey))
    const item = itemMap.get(itemKey)
    if (!item) continue
    ordered.push(item)
    itemMap.delete(itemKey)
  }
  for (const item of itemMap.values()) {
    ordered.push(item)
  }

  return {
    ordered,
    itemOrder: ordered.map((item) => getPreviewItemKey(item)),
  }
}

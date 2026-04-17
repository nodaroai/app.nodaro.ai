import type { PreviewItem } from "@/types/nodes"

export function buildPreviewItemKey(
  sourceNodeId: string,
  sourceHandle?: string | null,
): string {
  return `${sourceNodeId}:${sourceHandle ?? ""}`
}

export function getPreviewItemKey(
  item: Pick<PreviewItem, "sourceNodeId" | "sourceHandle" | "itemKey">,
): string {
  return item.itemKey || buildPreviewItemKey(item.sourceNodeId, item.sourceHandle)
}

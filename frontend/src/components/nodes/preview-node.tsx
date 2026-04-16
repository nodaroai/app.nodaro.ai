"use client"

import { memo, useCallback, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Eye, FileText, ImageIcon, Film, Music } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isMediaUrl } from "@/lib/media-type"
import {
  extractNodeOutput,
  detectPreviewItemType,
} from "@/components/editor/workflow-editor/execution-graph"
import type { PreviewNodeData, PreviewItem } from "@/types/nodes"

const TYPE_ICON: Record<PreviewItem["type"], React.ReactNode> = {
  text: <FileText className="w-3 h-3 shrink-0 text-blue-400" />,
  image: <ImageIcon className="w-3 h-3 shrink-0 text-pink-400" />,
  video: <Film className="w-3 h-3 shrink-0 text-purple-400" />,
  audio: <Music className="w-3 h-3 shrink-0 text-amber-400" />,
  data: <FileText className="w-3 h-3 shrink-0 text-slate-400" />,
}

function PreviewItemRow({ item }: { readonly item: PreviewItem }) {
  return (
    <div className="flex items-start gap-1.5 px-1.5 py-1 rounded bg-muted/30">
      {TYPE_ICON[item.type]}
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-muted-foreground block truncate">{item.sourceNodeLabel}</span>
        {item.type === "image" && isMediaUrl(item.value) ? (
          <img
            src={item.value}
            crossOrigin="anonymous"
            alt=""
            className="w-full h-14 object-cover rounded mt-0.5"
            loading="lazy"
          />
        ) : item.type === "video" && isMediaUrl(item.value) ? (
          <video
            src={item.value}
            crossOrigin="anonymous"
            className="w-full h-14 object-cover rounded mt-0.5"
            muted
            playsInline
            preload="none"
          />
        ) : item.type === "audio" && isMediaUrl(item.value) ? (
          <span className="text-[10px] text-foreground/60 truncate block">{item.value.split("/").pop()}</span>
        ) : (
          <p className="text-[10px] text-foreground/80 line-clamp-2 break-words">{item.value}</p>
        )}
      </div>
    </div>
  )
}

function PreviewNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PreviewNodeData
  const allItems = nodeData.previewItems ?? []
  const visibleItems = allItems.filter((item) => item.visible !== false)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const hiddenCount = allItems.length - visibleItems.length

  // Auto-collect: compute a fingerprint of upstream outputs so we re-render
  // only when an edge changes or an upstream node produces new output.
  const upstreamFingerprint = useWorkflowStore(
    useCallback((s) => {
      const inEdges = s.edges.filter((e) => e.target === id)
      return inEdges.map((e) => {
        const src = s.nodes.find((n) => n.id === e.source)
        return src ? `${e.source}:${extractNodeOutput(src) ?? ""}` : ""
      }).join("||")
    }, [id])
  )

  // When the fingerprint changes, re-collect upstream data without requiring
  // manual execution. This mirrors the logic in execute-node.ts for "preview".
  useEffect(() => {
    const { nodes: currentNodes, edges: currentEdges } = useWorkflowStore.getState()
    const thisNode = currentNodes.find((n) => n.id === id)
    if (!thisNode) return
    const prevData = thisNode.data as PreviewNodeData

    const incomingEdges = currentEdges.filter((e) => e.target === id)

    // Preserve previous visibility settings and ordering
    const prevVisibility = new Map<string, boolean>()
    for (const item of prevData.previewItems ?? []) {
      prevVisibility.set(item.sourceNodeId, item.visible)
    }
    const prevOrder = prevData.itemOrder ?? []

    const freshItems: PreviewItem[] = []

    for (const edge of incomingEdges) {
      const sourceNode = currentNodes.find((n) => n.id === edge.source)
      if (!sourceNode) continue

      const raw = extractNodeOutput(sourceNode)
      const trimmed = raw?.trim()
      if (!trimmed) continue

      const srcType = sourceNode.type ?? ""
      const srcLabel = ((sourceNode.data as Record<string, unknown>).label as string) || srcType

      const itemType = detectPreviewItemType(srcType, trimmed)

      freshItems.push({
        type: itemType,
        value: trimmed,
        sourceNodeId: sourceNode.id,
        sourceNodeLabel: srcLabel,
        visible: prevVisibility.get(sourceNode.id) ?? true,
      })
    }

    // Apply saved ordering: known items first in saved order, new items appended
    const itemMap = new Map(freshItems.map((item) => [item.sourceNodeId, item]))
    const ordered: PreviewItem[] = []
    for (const oid of prevOrder) {
      const item = itemMap.get(oid)
      if (item) {
        ordered.push(item)
        itemMap.delete(oid)
      }
    }
    for (const item of itemMap.values()) {
      ordered.push(item)
    }

    const newOrder = ordered.map((item) => item.sourceNodeId)

    // Only update if items actually changed to avoid infinite loops
    const prevItems = prevData.previewItems ?? []
    const changed =
      ordered.length !== prevItems.length ||
      ordered.some((item, i) =>
        item.value !== prevItems[i]?.value ||
        item.type !== prevItems[i]?.type ||
        item.sourceNodeId !== prevItems[i]?.sourceNodeId ||
        item.sourceNodeLabel !== prevItems[i]?.sourceNodeLabel
      )

    if (changed) {
      updateNodeData(id, {
        previewItems: ordered,
        itemOrder: newOrder,
      })
    }
  }, [upstreamFingerprint, id, updateNodeData])

  return (
    <div className="relative" style={{ maxWidth: '260px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Eye className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Eye className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        {visibleItems.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {visibleItems.map((item, i) => (
              <PreviewItemRow key={`${item.sourceNodeId}-${i}`} item={item} />
            ))}
            {hiddenCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60 text-center py-0.5">
                +{hiddenCount} hidden
              </span>
            )}
          </div>
        ) : allItems.length > 0 ? (
          <div className="flex flex-col items-center justify-center h-14 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 gap-1">
            <Eye className="w-5 h-5" />
            <span className="text-[10px]">{allItems.length} items (all hidden)</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-14 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 gap-1">
            <Eye className="w-5 h-5" />
            <span className="text-[10px]">Connect nodes to preview</span>
          </div>
        )}
      </BaseNode>
      <HandleIcon icon={<Eye />} color="steel" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Eye />} color="steel" top="20px" />
    </div>
  )
}

export const PreviewNode = memo(PreviewNodeComponent)

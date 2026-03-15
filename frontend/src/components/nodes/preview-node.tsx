"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Eye, FileText, ImageIcon, Film, Music } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isMediaUrl } from "@/lib/media-type"
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
            alt=""
            className="w-full h-14 object-cover rounded mt-0.5"
            loading="lazy"
          />
        ) : item.type === "video" && isMediaUrl(item.value) ? (
          <video
            src={item.value}
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
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const hiddenCount = allItems.length - visibleItems.length

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
          status !== "running" ? (
            <RunNodeButton nodeId={id} credits={0} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
          ) : undefined
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: '50%', left: '-29px' }, hideHandle: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '50%', right: '-29px' }, hideHandle: true },
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
      <HandleIcon icon={<Eye />} color="steel" side="left" />
      <HandleIcon icon={<Eye />} color="steel" />
    </div>
  )
}

export const PreviewNode = memo(PreviewNodeComponent)

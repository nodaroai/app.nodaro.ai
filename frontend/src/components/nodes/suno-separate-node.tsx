"use client"

import { memo, useState } from "react"
import { Position, type NodeProps, NodeResizer, Handle } from "@xyflow/react"
import { Scissors, Loader2, AlertCircle, Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { SunoSeparateData } from "@/types/nodes"

function SunoSeparateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoSeparateData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const audioUrl = nodeData.generatedAudioUrl ?? nodeData.vocalUrl
  const separateCreditId = nodeData.type === "split_stem" ? "suno-separate-stem" : "suno-separate"
  const credits = useModelCredits(separateCreditId, nodeData.type === "split_stem" ? 10 : 5)
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <div className="relative" style={{ width: 220, minHeight: 220, overflow: 'visible' }}>
    <NodeResizer
      isVisible={!!selected}
      minWidth={180}
      minHeight={180}
      lineClassName="!border-[#ff0073]"
      handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
    />
    {/* Floating label above node */}
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Scissors className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Scissors className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
        {status === "running" && !audioUrl && (
          <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {audioUrl && (
          <div className="px-3 py-2">
            <AudioResultOverlay
              url={audioUrl}
              label={nodeData.label}
              hasResults={false}
              onExpand={() => setPreviewOpen(true)}
              onDelete={() => {}}
            />
          </div>
        )}

        {status === "failed" && !audioUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {status !== "running" && !audioUrl && status !== "failed" && (
          <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 120, flex: 1 }}>
            <Scissors className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          Separate · {nodeData.type === "split_stem" ? "12 Stems" : "Vocal/Inst"}
        </span>
      </div>
    </BaseNode>
    {/* Invisible input handle */}
    <Handle
      id="audio"
      type="target"
      position={Position.Left}
      className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
      style={{ top: '155px', left: '-29px', transform: 'none' }}
    />
    {/* Invisible output handle */}
    <Handle
      id="audio-out"
      type="source"
      position={Position.Right}
      className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
      style={{ top: '50px', right: '-29px', transform: 'none', left: 'auto' }}
    />
    {/* Input handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '155px', left: '-29px' }}
    >
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>
    {/* Output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '50px', right: '-29px' }}
    >
      <Scissors className="w-3.5 h-3.5 text-white" />
    </div>
    {audioUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="audio"
        url={audioUrl}
      />
    )}
    </div>
  )
}

export const SunoSeparateNode = memo(SunoSeparateNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps, NodeResizer, Handle } from "@xyflow/react"
import { Combine, Loader2, AlertCircle, Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { SunoMashupData } from "@/types/nodes"

function SunoMashupNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoMashupData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const audioUrl = nodeData.generatedAudioUrl
  const credits = useModelCredits("suno-mashup", 4)

  return (
    <div className="relative" style={{ width: 220, minHeight: 220, overflow: 'visible' }}>
    <NodeResizer
      isVisible={!!selected}
      minWidth={180}
      minHeight={180}
      lineClassName="!border-[#ff0073]"
      handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
    />
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Combine className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Combine className="h-4 w-4" />}
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
          <div className="relative group/audio px-3 py-2">
            <audio
              src={audioUrl}
              controls
              className="w-full h-8"
              preload="none"
              onClick={(e) => e.stopPropagation()}
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
            <Combine className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          Mashup
        </span>
      </div>
    </BaseNode>
    {/* Input handle 1 (audio1) */}
    <Handle
      id="audio1"
      type="target"
      position={Position.Left}
      className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
      style={{ top: '120px', left: '-29px', transform: 'none' }}
    />
    {/* Input handle 2 (audio2) */}
    <Handle
      id="audio2"
      type="target"
      position={Position.Left}
      className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
      style={{ top: '180px', left: '-29px', transform: 'none' }}
    />
    {/* Output handle */}
    <Handle
      id="audio-out"
      type="source"
      position={Position.Right}
      className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
      style={{ top: '50px', right: '-29px', transform: 'none', left: 'auto' }}
    />
    {/* Input handle icons */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '120px', left: '-29px' }}
    >
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '180px', left: '-29px' }}
    >
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>
    {/* Output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '50px', right: '-29px' }}
    >
      <Combine className="w-3.5 h-3.5 text-white" />
    </div>
    </div>
  )
}

export const SunoMashupNode = memo(SunoMashupNodeComponent)

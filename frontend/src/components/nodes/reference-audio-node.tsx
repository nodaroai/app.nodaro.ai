"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ReferenceAudioData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
  { id: "audio-out", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
] as const

function ReferenceAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceAudioData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const useFull = useFullResolution(id)
  const status = nodeData.extractionStatus ?? "idle"
  const hasAudio = Boolean(nodeData.extractedAudioUrl)
  const hasThumbnail = Boolean(nodeData.videoThumbnail)

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Music className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Music className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3 flex flex-col gap-1">
          {hasThumbnail ? (
            <div className="w-full rounded overflow-hidden border border-border">
              <CachedImage src={nodeData.videoThumbnail} alt="" className="w-full aspect-video object-cover" thumbnail={!useFull} thumbnailWidth={320} />
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-12 rounded border border-dashed border-muted-foreground/30 text-muted-foreground/40">
              <Music className="w-4 h-4" />
            </div>
          )}
          {nodeData.videoTitle && (
            <p className="text-[9px] text-muted-foreground truncate">{nodeData.videoTitle}</p>
          )}
          <div className="flex items-center gap-1">
            {status === "ready" && hasAudio && <CheckCircle2 className="w-2.5 h-2.5 text-green-500" />}
            {status === "extracting" && <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-500" />}
            {status === "failed" && <AlertCircle className="w-2.5 h-2.5 text-red-500" />}
            <span className="text-[9px] text-muted-foreground">
              {nodeData.sourceType === "youtube" ? "YT" : "File"}
            </span>
          </div>
        </div>
      </BaseNode>
      <HandleIcon icon={<Music />} color="cyan" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Music />} top="20px" />
    </div>
  )
}

export const ReferenceAudioNode = memo(ReferenceAudioNodeComponent)

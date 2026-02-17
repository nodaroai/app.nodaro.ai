"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { CachedImage } from "@/components/ui/cached-image"
import type { ReferenceAudioData } from "@/types/nodes"

function ReferenceAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceAudioData
  const status = nodeData.extractionStatus ?? "idle"
  const hasAudio = Boolean(nodeData.extractedAudioUrl)
  const hasThumbnail = Boolean(nodeData.videoThumbnail)

  return (
    <BaseNode
      id={id}
      label="Ref Audio"
      icon={<Music className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {hasThumbnail ? (
          <div className="w-full rounded overflow-hidden border border-border">
            <CachedImage src={nodeData.videoThumbnail} alt="" className="w-full aspect-video object-cover" />
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
  )
}

export const ReferenceAudioNode = memo(ReferenceAudioNodeComponent)
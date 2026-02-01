"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ReferenceAudioData } from "@/types/nodes"

function ReferenceAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReferenceAudioData
  const status = nodeData.extractionStatus ?? "idle"
  const hasAudio = Boolean(nodeData.extractedAudioUrl)
  const hasThumbnail = Boolean(nodeData.videoThumbnail)
  const hasContent = hasThumbnail || hasAudio

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Music className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <div className={`flex flex-col gap-1.5 ${hasContent ? "min-w-[200px]" : ""}`}>
        {hasThumbnail && (
          <div className="relative w-full h-24 rounded overflow-hidden bg-muted">
            <img src={nodeData.videoThumbnail} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        {nodeData.videoTitle && (
          <p className="text-xs text-foreground truncate max-w-[200px]">{nodeData.videoTitle}</p>
        )}

        {status === "extracting" && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Extracting audio...</span>
          </div>
        )}
        {status === "ready" && hasAudio && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="w-3 h-3" />
              <span className="text-xs">Audio ready</span>
            </div>
            <audio src={nodeData.extractedAudioUrl} controls className="w-full h-8" />
          </div>
        )}
        {status === "failed" && (
          <div className="flex items-center gap-1.5 text-red-500">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-xs">Extraction failed</span>
          </div>
        )}
        {status === "idle" && !hasAudio && !hasThumbnail && (
          <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Music className="w-5 h-5" />
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          {nodeData.sourceType === "youtube" ? "YouTube" : nodeData.sourceType === "upload" ? "Upload" : "URL"}
        </p>
      </div>
    </BaseNode>
  )
}

export const ReferenceAudioNode = memo(ReferenceAudioNodeComponent)

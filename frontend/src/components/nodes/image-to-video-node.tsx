"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle, Play } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ImageToVideoData } from "@/types/nodes"

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const status = nodeData.executionStatus ?? "idle"
  const videoUrl = nodeData.generatedVideoUrl

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Film className="h-4 w-4" />}
      category="ai"
      credits={20}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-28 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {status === "completed" && videoUrl && (
          <div
            className="flex items-center justify-center h-28 rounded-md bg-green-500/10 cursor-pointer hover:bg-green-500/20 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              window.open(videoUrl, "_blank")
            }}
          >
            <Play className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
        )}

        {status === "failed" && (
          <div className="flex items-center justify-center gap-1.5 h-28 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>Failed</span>
          </div>
        )}

        {status === "idle" && (
          <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Film className="w-6 h-6" />
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span>{nodeData.provider}</span>
          <span>{nodeData.duration}s</span>
        </div>
      </div>
    </BaseNode>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)

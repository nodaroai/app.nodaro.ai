"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ImageToVideoData } from "@/types/nodes"

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const status = nodeData.executionStatus ?? "idle"
  const videoUrl = nodeData.generatedVideoUrl
  const results = nodeData.generatedResults ?? []
  const olderResults = results.slice(1)

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
          <div className="relative">
            <video
              src={videoUrl}
              className="w-full h-28 object-cover rounded-md cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                window.open(videoUrl, "_blank")
              }}
              autoPlay
              muted
              loop
              playsInline
            />
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
              Video
            </div>
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

        {olderResults.length > 0 && (
          <div className="flex gap-1 overflow-x-auto">
            {olderResults.slice(0, 4).map((r) => (
              <video
                key={r.jobId}
                src={r.url}
                className="w-10 h-10 object-cover rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  window.open(r.url, "_blank")
                }}
                muted
                playsInline
              />
            ))}
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

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ImageToVideoData } from "@/types/nodes"

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl

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

        {status !== "running" && activeUrl && (
          <div className="relative">
            <video
              src={activeUrl}
              className="w-full h-28 object-cover rounded-md cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                window.open(activeUrl, "_blank")
              }}
              autoPlay={videoAutoplay}
              muted
              loop={videoAutoplay}
              playsInline
            />
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
              Video
            </div>
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex items-center justify-center gap-1.5 h-28 rounded-md bg-red-500/5 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>Failed</span>
          </div>
        )}

        {status !== "running" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Film className="w-6 h-6" />
          </div>
        )}

        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <video
                key={r.jobId}
                src={r.url}
                className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                  i === activeIndex
                    ? "opacity-100 ring-2 ring-primary"
                    : "opacity-50 hover:opacity-80"
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
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

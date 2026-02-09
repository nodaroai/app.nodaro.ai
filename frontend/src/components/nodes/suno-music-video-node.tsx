"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { SunoMusicVideoData } from "@/types/nodes"

function SunoMusicVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoMusicVideoData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const videoUrl = nodeData.generatedVideoUrl
  const credits = useModelCredits("suno-music-video", 3)

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Film className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      handles={[
        { id: "audio", type: "target", position: Position.Left, label: "Audio" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && !videoUrl && (
          <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {videoUrl && (
          <div className="w-full rounded-md bg-muted/30 overflow-hidden">
            <video
              src={videoUrl}
              controls
              className="w-full rounded-md"
              preload="none"
            />
            {status === "running" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}

        {status === "failed" && !videoUrl && (
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

        {status !== "running" && !videoUrl && status !== "failed" && (
          <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Film className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">Music Video</span>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const SunoMusicVideoNode = memo(SunoMusicVideoNodeComponent)

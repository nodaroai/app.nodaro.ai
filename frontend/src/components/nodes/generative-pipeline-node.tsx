"use client"

import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { GenerativePipelineNodeData } from "@/types/nodes"
import { cn } from "@/lib/utils"

function GenerativePipelineNodeImpl({ data, selected }: NodeProps) {
  const nodeData = data as GenerativePipelineNodeData
  const status = nodeData.status ?? "queued"
  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-white dark:bg-[#1E1E1E] p-3 min-w-[200px] shadow-sm",
        selected
          ? "border-blue-500"
          : "border-zinc-300 dark:border-[#2D2D2D]",
      )}
      data-testid="generative-pipeline-node"
    >
      <Handle type="target" position={Position.Left} id="story_prompt" style={{ top: 24 }} />
      <span
        className="absolute left-3 top-[24px] -translate-y-1/2 text-[10px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap pointer-events-none"
      >
        prompt
      </span>
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Story → Video</div>
      <div className="mt-1 font-semibold">{nodeData.label ?? "Pipeline"}</div>
      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
        {nodeData.target_duration_seconds ?? "—"}s · {nodeData.format ?? "—"}
      </div>
      <div className="mt-2 text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5",
            status === "running" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
            status === "awaiting_approval" && "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
            status === "completed" && "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
            status === "failed" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
            status === "cancelled" && "bg-zinc-100 text-zinc-700 dark:bg-[#2D2D2D] dark:text-zinc-300",
          )}
        >
          {status.replace("_", " ")}
        </span>
      </div>
      <Handle type="source" position={Position.Right} id="final_video" style={{ top: 24 }} />
      <span
        className="absolute right-3 top-[24px] -translate-y-1/2 text-[10px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap pointer-events-none"
      >
        video
      </span>
    </div>
  )
}

export const GenerativePipelineNode = memo(GenerativePipelineNodeImpl)

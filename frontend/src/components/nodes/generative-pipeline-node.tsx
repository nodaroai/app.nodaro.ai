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
        "rounded-lg border-2 bg-white p-3 min-w-[200px] shadow-sm",
        selected ? "border-blue-500" : "border-zinc-300",
      )}
      data-testid="generative-pipeline-node"
    >
      <Handle type="target" position={Position.Left} id="story_prompt" />
      <div className="text-xs uppercase tracking-wide text-zinc-500">Story → Video</div>
      <div className="mt-1 font-semibold">{nodeData.label ?? "Pipeline"}</div>
      <div className="mt-2 text-xs text-zinc-600">
        {nodeData.target_duration_seconds ?? "—"}s · {nodeData.format ?? "—"}
      </div>
      <div className="mt-2 text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5",
            status === "running" && "bg-amber-100 text-amber-800",
            status === "awaiting_approval" && "bg-blue-100 text-blue-800",
            status === "completed" && "bg-green-100 text-green-800",
            status === "failed" && "bg-red-100 text-red-800",
            status === "cancelled" && "bg-zinc-100 text-zinc-700",
          )}
        >
          {status.replace("_", " ")}
        </span>
      </div>
      <Handle type="source" position={Position.Right} id="final_video" />
    </div>
  )
}

export const GenerativePipelineNode = memo(GenerativePipelineNodeImpl)

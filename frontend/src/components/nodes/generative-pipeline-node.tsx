"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Type, Clapperboard } from "lucide-react"
import { BaseNode } from "./base-node"
import { HandleIcon } from "./handle-icon"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { GenerativePipelineNodeData } from "@/types/nodes"
import { cn } from "@/lib/utils"

function GenerativePipelineNodeImpl({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerativePipelineNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.status ?? "queued"
  const label = nodeData.label ?? "Story → Video"
  return (
    <div
      className="relative"
      style={{ width: "100%", height: "100%" }}
      data-testid="generative-pipeline-node"
    >
      {/* Floating label above node */}
      <EditableNodeLabel
        label={label}
        icon={<Film className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={label}
        icon={<Film className="h-4 w-4" />}
        category="scene"
        selected={selected}
        isRunning={status === "running"}
        minWidth={200}
        minHeight={120}
        hideHeader
        handles={[
          { id: "story_prompt", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 20px)", left: "-29px" }, hideHandle: true },
          { id: "final_video", type: "source", position: Position.Right, customStyle: { top: "20px", right: "-29px" }, hideHandle: true },
        ]}
      >
        <div className="flex h-full flex-col gap-2 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Story → Video
          </div>
          <div className="text-xs text-zinc-600 dark:text-zinc-300">
            {nodeData.target_duration_seconds ?? "—"}s · {(nodeData.format ?? "—").replace("_", " ")}
          </div>
          <div>
            <span
              className={cn(
                "inline-block rounded px-1.5 py-0.5 text-xs",
                status === "queued" && "bg-zinc-100 text-zinc-600 dark:bg-[#2D2D2D] dark:text-zinc-400",
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
        </div>
      </BaseNode>
      {/* Story prompt input handle icon (bottom-left) */}
      <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)" label="prompt" />
      {/* Final video output handle icon (top-right) */}
      <HandleIcon icon={<Clapperboard />} color="pink" side="right" top="20px" label="video" />
    </div>
  )
}

export const GenerativePipelineNode = memo(GenerativePipelineNodeImpl)

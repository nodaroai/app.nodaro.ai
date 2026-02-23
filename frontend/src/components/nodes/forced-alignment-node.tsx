"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlignLeft, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { ForcedAlignmentData, AlignmentWord } from "@/types/nodes"

function ForcedAlignmentNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ForcedAlignmentData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const alignment = nodeData.alignmentResults ?? []
  const credits = useModelCredits("elevenlabs-forced-alignment", 3)

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<AlignLeft className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Audio" },
        { id: "data", type: "source", position: Position.Right, label: "Alignment" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {status === "completed" && alignment.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-24 overflow-y-auto">
            <div className="flex flex-wrap gap-1">
              {alignment.slice(0, 20).map((w: AlignmentWord, i: number) => (
                <span key={i} className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-primary/10 text-[10px]">
                  <span className="font-medium">{w.word}</span>
                  <span className="text-muted-foreground">{w.start.toFixed(2)}s</span>
                </span>
              ))}
              {alignment.length > 20 && (
                <span className="text-muted-foreground text-[10px]">+{alignment.length - 20} more</span>
              )}
            </div>
          </div>
        )}

        {status === "failed" && (
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

        {status !== "running" && status !== "failed" && alignment.length === 0 && (
          <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <AlignLeft className="w-5 h-5" />
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span>Forced Alignment</span>
        </div>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const ForcedAlignmentNode = memo(ForcedAlignmentNodeComponent)

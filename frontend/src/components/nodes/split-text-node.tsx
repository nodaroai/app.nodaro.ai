"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors, FileText } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SplitTextData } from "@/types/nodes"

function SplitTextNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SplitTextData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

  const partCount = nodeData.splitResults?.length ?? 0
  const separator = nodeData.separator || "===NEXT==="
  const separatorLabel = separator === "\n" ? "\\n" : separator.length > 8 ? `${separator.slice(0, 6)}...` : separator

  return (
    <div className="relative group/run">
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Scissors className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        handles={[
          { id: "in", type: "target", position: Position.Left, label: "Text In" },
          { id: "out", type: "source", position: Position.Right, label: "Items Out" },
        ]}
      >
        <div className="flex flex-col gap-1">
          {partCount > 0 ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80">
                {partCount} item{partCount !== 1 ? "s" : ""}
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Split by &quot;{separatorLabel}&quot;
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
            </div>
          )}

          <div className="flex justify-between text-muted-foreground">
            <span>Separator: &quot;{separatorLabel}&quot;</span>
          </div>
        </div>
      </BaseNode>
      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const SplitTextNode = memo(SplitTextNodeComponent)

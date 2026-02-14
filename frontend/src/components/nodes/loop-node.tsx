"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Repeat } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { LoopNodeData, LoopColumn } from "@/types/nodes"

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  return columns.map((col) => ({
    id: col.handleId,
    type: "source" as const,
    position: Position.Right,
    label: col.name,
  }))
}

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"

  const handles = useMemo(() => buildHandles(nodeData.columns ?? []), [nodeData.columns])

  const rowCount = nodeData.rows?.length ?? 0
  const colCount = nodeData.columns?.length ?? 0

  return (
    <div className="relative group/run">
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Repeat className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        handles={handles}
      >
        <p className="text-sm text-muted-foreground">
          {colCount > 0
            ? `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
            : "Click to configure..."}
        </p>
      </BaseNode>
      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const LoopNode = memo(LoopNodeComponent)

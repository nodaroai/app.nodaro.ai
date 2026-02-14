"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Repeat } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { LoopNodeData, LoopColumn } from "@/types/nodes"

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  const target = {
    id: "in",
    type: "target" as const,
    position: Position.Left,
    label: "In",
  }

  if (columns.length === 0) {
    return [target]
  }

  const sources = columns.map((col, i) => {
    const pct = Math.round(((i + 1) / (columns.length + 1)) * 100)
    return {
      id: col.handleId,
      type: "source" as const,
      position: Position.Right,
      label: col.name,
      top: `${pct}%`,
    }
  })

  return [target, ...sources]
}

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"

  const columns = nodeData.columns ?? []
  const handles = useMemo(() => buildHandles(columns), [columns])

  // Notify React Flow when handles change so new handles become connectable
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columns.length, updateNodeInternals])

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

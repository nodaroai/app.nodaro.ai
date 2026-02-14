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

  // Distribute source handles within the body area (below header).
  // Header occupies roughly the top 35%; place handles from 42% to 88%.
  const startPct = 42
  const endPct = 88
  const sources = columns.map((col, i) => {
    const pct = columns.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (columns.length - 1)) * (endPct - startPct))
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
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"

  const columns = nodeData.columns ?? []
  const handles = useMemo(() => buildHandles(columns), [columns])

  // Check if an upstream node is connected to the "in" handle
  const hasUpstreamInput = useMemo(
    () => edges.some((e) => e.target === id && e.targetHandle === "in"),
    [edges, id],
  )

  // Notify React Flow when handles change so new handles become connectable
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columns.length, updateNodeInternals])

  const rowCount = nodeData.rows?.length ?? 0
  const colCount = nodeData.columns?.length ?? 0

  // Build status text
  let statusText: string
  if (hasUpstreamInput) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

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
        <div style={{ minHeight: colCount > 1 ? `${colCount * 22 + 8}px` : undefined }}>
          <p className="text-sm text-muted-foreground">
            {statusText}
          </p>
        </div>
      </BaseNode>
      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}

export const LoopNode = memo(LoopNodeComponent)

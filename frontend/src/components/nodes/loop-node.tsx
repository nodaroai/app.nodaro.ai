"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Repeat, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { LOOP_COLUMN_TYPE_META, type LoopNodeData, type LoopColumn } from "@/types/nodes"

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  const target = {
    id: "in",
    type: "target" as const,
    position: Position.Left,
    customStyle: { top: 'calc(100% - 20px)', left: '-29px' },
    hideHandle: true,
  }

  if (columns.length === 0) {
    return [target]
  }

  const startPct = 30
  const endPct = 80
  const sources = columns.map((col, i) => {
    const pct = columns.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (columns.length - 1)) * (endPct - startPct))
    return {
      id: col.handleId,
      type: "source" as const,
      position: Position.Right,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, right: '-29px' },
      hideHandle: true,
    }
  })

  return [target, ...sources]
}

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"

  const columns = nodeData.columns ?? []
  const handles = useMemo(() => buildHandles(columns), [columns])

  const hasUpstreamInput = useMemo(
    () => edges.some((e) => e.target === id && e.targetHandle === "in"),
    [edges, id],
  )

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columns.length, updateNodeInternals])

  const rowCount = nodeData.rows?.length ?? 0
  const colCount = nodeData.columns?.length ?? 0

  let statusText: string
  if (hasUpstreamInput) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

  const sourceHandles = handles.filter(h => h.type === "source")
  const hasTarget = handles.some(h => h.id === "in")

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Repeat className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Repeat className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        minWidth={220}
        hideHeader
        topToolbarContent={
          status !== "running" ? (
            <RunNodeButton nodeId={id} credits={0} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
          ) : undefined
        }
        handles={handles}
      >
        <div className="p-3" style={{ minHeight: colCount > 1 ? `${colCount * 22 + 8}px` : undefined }}>
          <p className="text-sm text-muted-foreground">
            {statusText}
          </p>
          {columns.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {columns.map((col) => {
                const colColor = LOOP_COLUMN_TYPE_META[col.type ?? "text"]?.color ?? "#38BDF8"
                return (
                  <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                    style={{
                      background: `${colColor}20`,
                      color: colColor,
                    }}>
                    {col.name}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </BaseNode>
      {hasTarget && <HandleIcon icon={<Type />} side="left" top="calc(100% - 20px)" />}
      {sourceHandles.map((h) => (
        <HandleIcon key={h.id} icon={<Type />} top={h.top} />
      ))}
    </div>
  )
}

export const LoopNode = memo(LoopNodeComponent)

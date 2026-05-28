"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Filter, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import type { JsonProcessNodeData } from "@/types/nodes"

function JsonProcessNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as JsonProcessNodeData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const modeBadge = nodeData.mode === "advanced" ? "Advanced" : "Visual"

  const summaryLine =
    nodeData.mode === "advanced"
      ? nodeData.expression.length > 40
        ? nodeData.expression.slice(0, 40) + "..."
        : nodeData.expression || "(no expression)"
      : [
          nodeData.inputPath ? `.${nodeData.inputPath}` : "(root)",
          `${nodeData.filters?.length ?? 0} filter${(nodeData.filters?.length ?? 0) === 1 ? "" : "s"}`,
          `${nodeData.projections?.length ?? 0} field${(nodeData.projections?.length ?? 0) === 1 ? "" : "s"}`,
        ].join(" \u2192 ")

  let resultLabel: string | undefined
  if (status === "completed" && nodeData.processedResult !== undefined) {
    const r = nodeData.processedResult
    if (Array.isArray(r)) {
      resultLabel = `${r.length} item${r.length === 1 ? "" : "s"}`
    } else if (r !== null && typeof r === "object") {
      const keyCount = Object.keys(r as object).length
      resultLabel = `object (${keyCount} key${keyCount === 1 ? "" : "s"})`
    } else {
      resultLabel = String(r)
    }
  }

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Filter className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Filter className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={[
          { id: "in",  type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">
              {modeBadge}
            </span>
          </div>
          {resultLabel !== undefined ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs font-medium text-emerald-400">{resultLabel}</p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block truncate">{summaryLine}</span>
            </div>
          ) : (
            <div className="flex flex-col items-start justify-center min-h-10 rounded-md border-2 border-dashed border-muted-foreground/20 px-2 py-1.5">
              <span className="text-[10px] text-muted-foreground/60 truncate w-full">{summaryLine}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="json-process" handleId="in"  type="target" position={Position.Left}  label="JSON"   color="#818CF8" icon={<Filter />} side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="json-process" handleId="out" type="source" position={Position.Right} label="Result" color="#475569" icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const JsonProcessNode = memo(JsonProcessNodeComponent)

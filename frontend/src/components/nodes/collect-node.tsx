"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Funnel, FileText, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import { COLLECT_STRATEGIES } from "@nodaro/shared"
import type { CollectNodeData } from "@/types/nodes"

/**
 * Collect (fan-in) node — reduces N upstream branch results into a single
 * output via a pluggable strategy. The strategy registry is the single
 * source of truth in `@nodaro/shared/collect-strategy-registry`.
 *
 * The "N → 1" pill surfaces the upstream branch count when known
 * (set by the workflow executor on `data.__upstreamCount`). When the
 * upstream hasn't run yet we hide the count entirely — empty is the
 * idle state, not "0 → 1".
 */
function CollectNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CollectNodeData & { __upstreamCount?: number }
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const strategy = COLLECT_STRATEGIES.find((s) => s.id === nodeData.strategyId)
  const strategyLabel = strategy?.label ?? "Collect"
  const upstreamCount = typeof nodeData.__upstreamCount === "number" ? nodeData.__upstreamCount : undefined
  const showPill = upstreamCount !== undefined && upstreamCount > 0
  const hasResult = status === "completed" && typeof nodeData.result === "string"

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Funnel className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Funnel className="h-4 w-4" />}
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
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 20px)", left: "-29px" }, hideHandle: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "20px", right: "-29px" }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Collect
            </span>
            {showPill && (
              <span className="text-[9px] bg-[#ff0073]/20 text-[#ff0073] px-1.5 py-0.5 rounded font-medium">
                {upstreamCount} &rarr; 1
              </span>
            )}
          </div>
          {hasResult ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80 truncate">
                {strategyLabel}
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Reduced to 1 result
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
              <span className="text-[10px] mt-0.5 px-1 text-center">
                {strategyLabel}
              </span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={<Braces />} color="indigo" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<FileText />} color="steel" top="20px" />
    </div>
  )
}

export const CollectNode = memo(CollectNodeComponent)

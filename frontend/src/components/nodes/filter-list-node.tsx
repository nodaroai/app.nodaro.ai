"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListFilter, FileText, Braces, Variable } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import { VARIABLES_HANDLE_ID } from "@nodaro-shared/condition-variables"
import type { FilterListNodeData } from "@/types/nodes"

function FilterListNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as FilterListNodeData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const conditionCount = nodeData.conditions?.length ?? 0
  const logic = nodeData.conditionLogic ?? "AND"
  const listResults = nodeData.__listResults ?? nodeData.listResults
  const itemCount = listResults?.length ?? 0
  const hasResult = status === "completed" && listResults !== undefined

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ListFilter className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ListFilter className="h-4 w-4" />}
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
          { id: VARIABLES_HANDLE_ID, type: "target", position: Position.Left, customStyle: { top: "20px", left: "-29px" }, hideHandle: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "20px", right: "-29px" }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {hasResult ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80">
                {itemCount} item{itemCount === 1 ? "" : "s"} kept
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                {conditionCount === 0
                  ? "No conditions"
                  : `${conditionCount} condition${conditionCount === 1 ? "" : "s"} (${logic})`}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">
                {conditionCount === 0
                  ? "No conditions"
                  : `${conditionCount} condition${conditionCount === 1 ? "" : "s"} (${logic})`}
              </span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={<Braces />} color="indigo" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Variable />} color="orange" side="left" top="20px" label="Variables" />
      <HandleIcon icon={<FileText />} color="steel" top="20px" />
    </div>
  )
}

export const FilterListNode = memo(FilterListNodeComponent)

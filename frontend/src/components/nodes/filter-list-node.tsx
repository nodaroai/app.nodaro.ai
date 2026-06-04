"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListFilter, FileText, Braces, Variable } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import { VARIABLES_HANDLE_ID } from "@nodaro/shared"
import type { FilterListNodeData } from "@/types/nodes"
import { isValidFilterListConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { isVisualPickerType } from "@/lib/parameter-picker-types"

const ACCEPTS_IN        = (t: string) => isValidFilterListConnection("in", t, isVisualPickerType)
const ACCEPTS_VARIABLES = (t: string) => isValidFilterListConnection("variables", t, isVisualPickerType)

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
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          // Inputs stack bottom-up: `in` at the bottom, `variables` above it.
          { id: VARIABLES_HANDLE_ID, type: "target", position: Position.Left, customStyle: { top: "calc(100% - 56px)", left: "-29px" }, external: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
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
      <HandleWithPopover nodeId={id} nodeType="filter-list" handleId="in"                  type="target" position={Position.Left}  label="List"      color={DATA_HANDLE_COLORS.list}      icon={<Braces />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="filter-list" handleId={VARIABLES_HANDLE_ID} type="target" position={Position.Left}  label="Variables" color={DATA_HANDLE_COLORS.variables} icon={<Variable />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_VARIABLES} />
      <HandleWithPopover nodeId={id} nodeType="filter-list" handleId="out"                 type="source" position={Position.Right} label="Filtered"  color={DATA_HANDLE_COLORS.list}      icon={<FileText />} side="right" top="24px" />
    </div>
  )
}

export const FilterListNode = memo(FilterListNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListTree, FileText, Braces, Variable } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import { VARIABLES_HANDLE_ID } from "@nodaro/shared"
import type { SelectorNodeData } from "@/types/nodes"
import { isValidSelectorConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { isVisualPickerType } from "@/lib/parameter-picker-types"

/** Selector's `in` mirrors the list-consumer contract used by sort/filter/
 *  deduplicate — only list/json producers are accepted. `variables` mirrors
 *  filter-list's variables handle (any data producer; resolved by name in
 *  buildConditionVariables for modulo / predicate / named-key / seed). */
const ACCEPTS_IN        = (t: string) => isValidSelectorConnection("in",        t, isVisualPickerType)
const ACCEPTS_VARIABLES = (t: string) => isValidSelectorConnection("variables", t, isVisualPickerType)

function SelectorNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SelectorNodeData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const mode = nodeData.config?.mode ?? "item"
  const pickedTotal = nodeData.__pickedTotal ?? nodeData.pickedResults?.length ?? 0
  const restTotal = nodeData.__restTotal ?? nodeData.restResults?.length ?? 0
  const hasResult =
    status === "completed" &&
    (nodeData.pickedResults !== undefined || nodeData.restResults !== undefined)

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ListTree className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ListTree className="h-4 w-4" />}
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
          { id: "in",                  type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          // Inputs stack bottom-up: `in` at the bottom, `variables` above it.
          { id: VARIABLES_HANDLE_ID,   type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 56px)", left: "-29px" }, external: true },
          { id: "picked",              type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "rest",                type: "source", position: Position.Right, customStyle: { top: "56px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {hasResult ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80">
                {pickedTotal} picked · {restTotal} rest
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Mode: {mode}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Mode: {mode}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="selector" handleId="in"                  type="target" position={Position.Left}  label="List"      color={DATA_HANDLE_COLORS.list}      icon={<Braces />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="selector" handleId={VARIABLES_HANDLE_ID} type="target" position={Position.Left}  label="Variables" color={DATA_HANDLE_COLORS.variables} icon={<Variable />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_VARIABLES} />
      <HandleWithPopover nodeId={id} nodeType="selector" handleId="picked"              type="source" position={Position.Right} label="Picked"    color={DATA_HANDLE_COLORS.list}      icon={<FileText />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="selector" handleId="rest"                type="source" position={Position.Right} label="Rest"      color={DATA_HANDLE_COLORS.list}      icon={<FileText />} side="right" top="56px" />
    </div>
  )
}

export const SelectorNode = memo(SelectorNodeComponent)

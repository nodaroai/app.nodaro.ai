"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, FileText } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import type { ExtractFieldNodeData } from "@/types/nodes"

function ExtractFieldNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ExtractFieldNodeData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const field = nodeData.field?.trim() ?? ""
  const fieldLabel = field === "" ? "(whole item)" : field
  const isJsonOutput = nodeData.outputType === "json"
  const listResults = (nodeData as Record<string, unknown>).__listResults as string[] | undefined
  const itemCount = listResults?.length ?? 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Braces className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Braces className="h-4 w-4" />}
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
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {itemCount > 0 ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80">
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Field: {fieldLabel}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Field: {fieldLabel}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={<Braces />} color="indigo" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={isJsonOutput ? <Braces /> : <FileText />} color={isJsonOutput ? "indigo" : "steel"} top="20px" />
    </div>
  )
}

export const ExtractFieldNode = memo(ExtractFieldNodeComponent)

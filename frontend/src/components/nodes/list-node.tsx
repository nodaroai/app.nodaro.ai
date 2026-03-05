"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { List } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ListNodeData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: '50%', left: '-6px' }, hideHandle: true },
  { id: "list", type: "source" as const, position: Position.Right, customStyle: { top: '50%', right: '-29px' }, hideHandle: true },
] as const

function ListNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ListNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const itemCount = nodeData.items
    ? nodeData.items.split("\n").filter((line) => line.trim() !== "").length
    : 0

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<List className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<List className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3">
          <p className="text-sm text-muted-foreground">
            {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "No items yet"}
          </p>
        </div>
      </BaseNode>
      <HandleIcon icon={<List />} />
    </div>
  )
}

export const ListNode = memo(ListNodeComponent)

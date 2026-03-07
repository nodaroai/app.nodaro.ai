"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { HardDrive } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SaveToStorageData } from "@/types/nodes"

function SaveToStorageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SaveToStorageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<HardDrive className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<HardDrive className="h-4 w-4" />}
        category="output"
        credits={0}
        selected={selected}
        hideHeader
        minWidth={220}
        handles={[
          { id: "in", type: "target", position: Position.Left, hideHandle: true, customStyle: { top: '50%', left: '-29px' } },
          { id: "out", type: "source", position: Position.Right, hideHandle: true, customStyle: { top: '50%', right: '-29px' } },
        ]}
      >
        <p className="text-muted-foreground truncate max-w-[180px]">
          {nodeData.format} ({nodeData.quality})
        </p>
      </BaseNode>
      <HandleIcon icon={<HardDrive />} color="green" side="left" />
      <HandleIcon icon={<HardDrive />} color="green" />
    </div>
  )
}

export const SaveToStorageNode = memo(SaveToStorageNodeComponent)

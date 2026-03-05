"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ShieldCheck, Type, Check, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { QACheckData } from "@/types/nodes"

function QACheckNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as QACheckData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ShieldCheck className="h-4 w-4" />}
        category="ai"
        credits={1}
        selected={selected}
        hideHeader
        minWidth={220}
        handles={[
          { id: "in", type: "target", position: Position.Left, hideHandle: true, customStyle: { top: '50%', left: '-29px' } },
          { id: "approved", type: "source", position: Position.Right, label: "Approved", hideHandle: true, customStyle: { top: '35%', right: '-29px' } },
          { id: "rejected", type: "source", position: Position.Right, label: "Rejected", hideHandle: true, customStyle: { top: '65%', right: '-29px' } },
        ]}
      >
        <p className="text-muted-foreground truncate max-w-[180px]">
          {nodeData.checkType} ({nodeData.provider})
        </p>
      </BaseNode>
      <HandleIcon icon={<Type />} color="pink" side="left" />
      <HandleIcon icon={<Check />} color="green" top="35%" />
      <HandleIcon icon={<X />} color="red" top="65%" />
    </div>
  )
}

export const QACheckNode = memo(QACheckNodeComponent)

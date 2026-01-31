"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ShieldCheck } from "lucide-react"
import { BaseNode } from "./base-node"
import type { QACheckData } from "@/types/nodes"

function QACheckNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as QACheckData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ShieldCheck className="h-4 w-4" />}
      category="ai"
      credits={1}
      selected={selected}
      handles={[
        { id: "content", type: "target", position: Position.Left, label: "Content" },
        { id: "approved", type: "source", position: Position.Right, label: "Approved", top: "40%" },
        { id: "rejected", type: "source", position: Position.Right, label: "Rejected", top: "70%" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.checkType} ({nodeData.provider})
      </p>
    </BaseNode>
  )
}

export const QACheckNode = memo(QACheckNodeComponent)

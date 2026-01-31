"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clock } from "lucide-react"
import { BaseNode } from "./base-node"
import type { DurationData } from "@/types/nodes"

function DurationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as DurationData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Clock className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "duration", type: "source", position: Position.Right, label: "Duration" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.seconds}s
      </p>
    </BaseNode>
  )
}

export const DurationNode = memo(DurationNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Activity } from "lucide-react"
import { BaseNode } from "./base-node"
import type { MotionData } from "@/types/nodes"

function MotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MotionData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Activity className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "out", type: "source", position: Position.Right, label: "Motion" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.motion}
      </p>
    </BaseNode>
  )
}

export const MotionNode = memo(MotionNodeComponent)

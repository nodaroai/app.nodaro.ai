"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Hash } from "lucide-react"
import { BaseNode } from "./base-node"
import type { SceneCountData } from "@/types/nodes"

function SceneCountNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SceneCountData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Hash className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "count", type: "source", position: Position.Right, label: "Count" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.count} scenes
      </p>
    </BaseNode>
  )
}

export const SceneCountNode = memo(SceneCountNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { RectangleHorizontal } from "lucide-react"
import { BaseNode } from "./base-node"
import type { AspectRatioData } from "@/types/nodes"

function AspectRatioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AspectRatioData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<RectangleHorizontal className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "ratio", type: "source", position: Position.Right, label: "Ratio" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.ratio}
      </p>
    </BaseNode>
  )
}

export const AspectRatioNode = memo(AspectRatioNodeComponent)

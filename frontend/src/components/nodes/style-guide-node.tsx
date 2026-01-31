"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Brush } from "lucide-react"
import { BaseNode } from "./base-node"
import type { StyleGuideData } from "@/types/nodes"

function StyleGuideNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StyleGuideData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Brush className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "style", type: "source", position: Position.Right, label: "Style" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.text || "Set style guide..."}
      </p>
    </BaseNode>
  )
}

export const StyleGuideNode = memo(StyleGuideNodeComponent)

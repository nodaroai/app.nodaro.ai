"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Merge } from "lucide-react"
import { BaseNode } from "./base-node"
import type { CombineVideosData } from "@/types/nodes"

function CombineVideosNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CombineVideosData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Merge className="h-4 w-4" />}
      category="processing"
      credits={2}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-1 text-muted-foreground">
        <span>Transition: {nodeData.transition}</span>
      </div>
    </BaseNode>
  )
}

export const CombineVideosNode = memo(CombineVideosNodeComponent)

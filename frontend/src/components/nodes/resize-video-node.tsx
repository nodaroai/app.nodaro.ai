"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Maximize2 } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ResizeVideoData } from "@/types/nodes"

function ResizeVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ResizeVideoData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Maximize2 className="h-4 w-4" />}
      category="processing"
      credits={1}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.targetAspect} ({nodeData.method})
      </p>
    </BaseNode>
  )
}

export const ResizeVideoNode = memo(ResizeVideoNodeComponent)

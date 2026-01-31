"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors } from "lucide-react"
import { BaseNode } from "./base-node"
import type { TrimVideoData } from "@/types/nodes"

function TrimVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TrimVideoData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Scissors className="h-4 w-4" />}
      category="processing"
      credits={0}
      selected={selected}
      handles={[
        { id: "video", type: "target", position: Position.Left, label: "Video" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.startTime}s - {nodeData.endTime}s
      </p>
    </BaseNode>
  )
}

export const TrimVideoNode = memo(TrimVideoNodeComponent)

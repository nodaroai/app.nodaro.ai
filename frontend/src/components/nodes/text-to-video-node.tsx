"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film } from "lucide-react"
import { BaseNode } from "./base-node"
import type { TextToVideoData } from "@/types/nodes"

function TextToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextToVideoData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Film className="h-4 w-4" />}
      category="ai"
      credits={25}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground truncate">
        {nodeData.prompt || `${nodeData.provider}/${nodeData.model}`}
      </p>
    </BaseNode>
  )
}

export const TextToVideoNode = memo(TextToVideoNodeComponent)

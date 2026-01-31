"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Captions } from "lucide-react"
import { BaseNode } from "./base-node"
import type { AddCaptionsData } from "@/types/nodes"

function AddCaptionsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AddCaptionsData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Captions className="h-4 w-4" />}
      category="processing"
      credits={2}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.style} ({nodeData.position})
      </p>
    </BaseNode>
  )
}

export const AddCaptionsNode = memo(AddCaptionsNodeComponent)

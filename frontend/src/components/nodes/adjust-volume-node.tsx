"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Volume1 } from "lucide-react"
import { BaseNode } from "./base-node"
import type { AdjustVolumeData } from "@/types/nodes"

function AdjustVolumeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AdjustVolumeData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Volume1 className="h-4 w-4" />}
      category="processing"
      credits={0}
      selected={selected}
      handles={[
        { id: "audio", type: "target", position: Position.Left, label: "Audio" },
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.volume}%{nodeData.normalize ? " (normalized)" : ""}
      </p>
    </BaseNode>
  )
}

export const AdjustVolumeNode = memo(AdjustVolumeNodeComponent)

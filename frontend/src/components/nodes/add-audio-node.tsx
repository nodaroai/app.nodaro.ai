"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
import type { AddAudioData } from "@/types/nodes"

function AddAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AddAudioData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Volume2 className="h-4 w-4" />}
      category="processing"
      credits={1}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.audioType} ({nodeData.voiceoverVolume}%)
      </p>
    </BaseNode>
  )
}

export const AddAudioNode = memo(AddAudioNodeComponent)

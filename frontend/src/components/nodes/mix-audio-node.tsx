"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Headphones } from "lucide-react"
import { BaseNode } from "./base-node"
import type { MixAudioData } from "@/types/nodes"

function MixAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MixAudioData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Headphones className="h-4 w-4" />}
      category="processing"
      credits={1}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.trackCount} tracks
      </p>
    </BaseNode>
  )
}

export const MixAudioNode = memo(MixAudioNodeComponent)

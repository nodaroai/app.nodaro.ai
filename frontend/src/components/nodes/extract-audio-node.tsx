"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AudioLines } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ExtractAudioData } from "@/types/nodes"

function ExtractAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ExtractAudioData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<AudioLines className="h-4 w-4" />}
      category="processing"
      credits={1}
      selected={selected}
      handles={[
        { id: "video", type: "target", position: Position.Left, label: "Video" },
        { id: "audio", type: "source", position: Position.Right, label: "Audio", top: "35%" },
        { id: "silent-video", type: "source", position: Position.Right, label: "Silent Video", top: "65%" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.audioFormat}
      </p>
    </BaseNode>
  )
}

export const ExtractAudioNode = memo(ExtractAudioNodeComponent)

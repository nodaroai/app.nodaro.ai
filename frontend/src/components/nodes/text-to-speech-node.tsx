"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Mic } from "lucide-react"
import { BaseNode } from "./base-node"
import type { TextToSpeechData } from "@/types/nodes"

function TextToSpeechNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextToSpeechData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Mic className="h-4 w-4" />}
      category="ai"
      credits={3}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "audio", type: "source", position: Position.Right, label: "Audio" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.provider} {nodeData.voiceId ? `- ${nodeData.voiceId}` : ""}
      </p>
    </BaseNode>
  )
}

export const TextToSpeechNode = memo(TextToSpeechNodeComponent)

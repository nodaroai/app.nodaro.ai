"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Type } from "lucide-react"
import { BaseNode } from "./base-node"
import type { TextPromptData } from "@/types/nodes"

function TextPromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextPromptData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Type className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "prompt", type: "source", position: Position.Right, label: "Prompt" },
      ]}
    >
      <p className="text-sm text-muted-foreground line-clamp-4">
        {nodeData.text || "Enter your prompt..."}
      </p>
    </BaseNode>
  )
}

export const TextPromptNode = memo(TextPromptNodeComponent)

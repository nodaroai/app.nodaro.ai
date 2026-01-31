"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { BookOpen } from "lucide-react"
import { BaseNode } from "./base-node"
import type { GenerateScriptData } from "@/types/nodes"

function GenerateScriptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateScriptData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<BookOpen className="h-4 w-4" />}
      category="ai"
      credits={2}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "scenes", type: "source", position: Position.Right, label: "Scenes" },
      ]}
    >
      <div className="flex flex-col gap-1 text-muted-foreground">
        <span>Provider: {nodeData.provider}</span>
        <span>Scenes: {nodeData.sceneCount}</span>
        {nodeData.styleGuide && (
          <span className="truncate max-w-[180px]">Style: {nodeData.styleGuide}</span>
        )}
      </div>
    </BaseNode>
  )
}

export const GenerateScriptNode = memo(GenerateScriptNodeComponent)

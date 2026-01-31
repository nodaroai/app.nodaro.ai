"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Palette } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ToneData } from "@/types/nodes"

function ToneNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ToneData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Palette className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "tone", type: "source", position: Position.Right, label: "Tone" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.tone || "Set tone..."}
      </p>
    </BaseNode>
  )
}

export const ToneNode = memo(ToneNodeComponent)

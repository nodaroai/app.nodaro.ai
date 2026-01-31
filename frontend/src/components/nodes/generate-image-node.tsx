"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon } from "lucide-react"
import { BaseNode } from "./base-node"
import type { GenerateImageData } from "@/types/nodes"

function GenerateImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateImageData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={5}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "image", type: "source", position: Position.Right, label: "Image" },
      ]}
    >
      <div className="flex flex-col gap-1 text-muted-foreground">
        <span>Provider: {nodeData.provider}</span>
        <span>Ratio: {nodeData.aspectRatio}</span>
      </div>
    </BaseNode>
  )
}

export const GenerateImageNode = memo(GenerateImageNodeComponent)

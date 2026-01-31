"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { HardDrive } from "lucide-react"
import { BaseNode } from "./base-node"
import type { SaveToStorageData } from "@/types/nodes"

function SaveToStorageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SaveToStorageData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<HardDrive className="h-4 w-4" />}
      category="output"
      credits={0}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.format} ({nodeData.quality})
      </p>
    </BaseNode>
  )
}

export const SaveToStorageNode = memo(SaveToStorageNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Cpu } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ProviderData } from "@/types/nodes"

function ProviderNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ProviderData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Cpu className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "provider", type: "source", position: Position.Right, label: "Provider" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.provider || "Select provider..."}
      </p>
    </BaseNode>
  )
}

export const ProviderNode = memo(ProviderNodeComponent)

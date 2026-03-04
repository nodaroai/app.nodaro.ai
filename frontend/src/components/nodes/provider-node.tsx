"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Cpu } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { ProviderData } from "@/types/nodes"
import { getProviderLabel, type ProviderCategory } from "@/lib/providers-config"

function ProviderNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ProviderData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Cpu />} handleId="provider" selected={selected}>
      <p className="text-muted-foreground truncate max-w-[180px] text-xs">
        {nodeData.provider
          ? `${getProviderLabel(nodeData.category as ProviderCategory, nodeData.provider)} / ${nodeData.model}`
          : "Select provider..."}
      </p>
    </ParameterNodeShell>
  )
}

export const ProviderNode = memo(ProviderNodeComponent)

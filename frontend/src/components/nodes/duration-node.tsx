"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Clock } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { DurationData } from "@/types/nodes"

function DurationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as DurationData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Clock />} handleId="duration" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {nodeData.seconds}s
      </p>
    </ParameterNodeShell>
  )
}

export const DurationNode = memo(DurationNodeComponent)

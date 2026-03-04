"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Activity } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MotionData } from "@/types/nodes"

function MotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MotionData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Activity />} handleId="out" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {nodeData.motion}
      </p>
    </ParameterNodeShell>
  )
}

export const MotionNode = memo(MotionNodeComponent)

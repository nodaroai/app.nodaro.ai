"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Hash } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { SceneCountData } from "@/types/nodes"

function SceneCountNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SceneCountData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Hash />} handleId="count" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {nodeData.count} scenes
      </p>
    </ParameterNodeShell>
  )
}

export const SceneCountNode = memo(SceneCountNodeComponent)

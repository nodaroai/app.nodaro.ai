"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { RectangleHorizontal } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { AspectRatioData } from "@/types/nodes"

function AspectRatioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AspectRatioData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<RectangleHorizontal />} handleId="ratio" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {nodeData.ratio}
      </p>
    </ParameterNodeShell>
  )
}

export const AspectRatioNode = memo(AspectRatioNodeComponent)

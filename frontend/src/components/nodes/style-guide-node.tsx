"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Brush } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { StyleGuideData } from "@/types/nodes"

function StyleGuideNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StyleGuideData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Brush />} handleId="style" selected={selected}>
      <p className="text-muted-foreground truncate max-w-[180px] text-xs">
        {nodeData.text || "Set style guide..."}
      </p>
    </ParameterNodeShell>
  )
}

export const StyleGuideNode = memo(StyleGuideNodeComponent)

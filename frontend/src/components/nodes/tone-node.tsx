"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Palette } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { ToneData } from "@/types/nodes"

function ToneNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ToneData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Palette />} handleId="tone" selected={selected}>
      <p className="text-muted-foreground truncate max-w-[180px] text-xs">
        {nodeData.tone || "Set tone..."}
      </p>
    </ParameterNodeShell>
  )
}

export const ToneNode = memo(ToneNodeComponent)

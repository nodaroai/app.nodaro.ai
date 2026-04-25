"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import { getAesthetic, getAestheticLabel } from "@nodaro-shared/aesthetic"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { AestheticData } from "@/types/nodes"

function AestheticNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AestheticData
  const aestheticId = nodeData.aesthetic || "y2k"
  const aesthetic = getAesthetic(aestheticId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Sparkles />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getAestheticLabel(aestheticId)}
      </p>
      {aesthetic?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {aesthetic.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AestheticNode = memo(AestheticNodeComponent)

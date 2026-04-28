"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import { getAesthetic, getAestheticLabel } from "@nodaro/shared"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { AestheticData } from "@/types/nodes"

function AestheticNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AestheticData
  const ids = pickIds(nodeData.aesthetic)
  const primaryId = ids[0] || "y2k"
  const extraIds = ids.slice(1)
  const aesthetic = getAesthetic(primaryId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Sparkles />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getAestheticLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getAestheticLabel(extraId)}
        </p>
      ))}
      {aesthetic?.description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {aesthetic.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AestheticNode = memo(AestheticNodeComponent)

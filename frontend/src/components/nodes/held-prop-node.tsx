"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { HandMetal } from "lucide-react"
import { getHeldProp, getHeldPropLabel } from "@nodaro-shared/held-prop"
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { HeldPropData } from "@/types/nodes"

function HeldPropNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as HeldPropData
  const ids = pickIds(nodeData.heldProp)
  const primaryId = ids[0] || "smartphone"
  const extraIds = ids.slice(1)
  const heldProp = getHeldProp(primaryId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<HandMetal />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getHeldPropLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getHeldPropLabel(extraId)}
        </p>
      ))}
      {heldProp?.description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {heldProp.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const HeldPropNode = memo(HeldPropNodeComponent)

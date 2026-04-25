"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { HandMetal } from "lucide-react"
import { getHeldProp, getHeldPropLabel } from "@nodaro-shared/held-prop"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { HeldPropData } from "@/types/nodes"

function HeldPropNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as HeldPropData
  const heldPropId = nodeData.heldProp || "smartphone"
  const heldProp = getHeldProp(heldPropId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<HandMetal />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getHeldPropLabel(heldPropId)}
      </p>
      {heldProp?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {heldProp.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const HeldPropNode = memo(HeldPropNodeComponent)

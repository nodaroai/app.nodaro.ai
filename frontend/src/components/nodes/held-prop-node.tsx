"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { HandMetal } from "lucide-react"
import { getHeldProp, getHeldPropLabel } from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { CharacterPickRow } from "./character-pick-row"
import type { HeldPropData } from "@/types/nodes"

function HeldPropNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as HeldPropData
  const ids = pickIds(nodeData.heldProp)
  const primaryId = ids[0] || "smartphone"
  const extraIds = ids.slice(1)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<HandMetal />} handleId="out" selected={selected}>
      <CharacterPickRow
        family="held-prop"
        id={primaryId}
        value={getHeldPropLabel(primaryId)}
        extras={extraIds.map((extraId) => getHeldPropLabel(extraId))}
        description={extraIds.length === 0 ? getHeldProp(primaryId)?.description : undefined}
      />
    </ParameterNodeShell>
  )
}

export const HeldPropNode = memo(HeldPropNodeComponent)

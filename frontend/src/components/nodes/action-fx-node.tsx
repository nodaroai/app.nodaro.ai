"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Zap } from "lucide-react"
import { getActionFx, getActionFxLabel } from "@nodaro/shared"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { ActionFxData } from "@/types/nodes"

function ActionFxNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ActionFxData
  const ids = pickIds(nodeData.actionFx)
  const primaryId = ids[0]
  const extraIds = ids.slice(1)
  const description = primaryId ? getActionFx(primaryId)?.description : undefined

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Zap />} handleId="out" selected={selected} fluidWidth>
      {primaryId ? (
        <p className="text-foreground text-sm font-medium">
          {getActionFxLabel(primaryId)}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Click to choose
        </p>
      )}
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getActionFxLabel(extraId)}
        </p>
      ))}
      {description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const ActionFxNode = memo(ActionFxNodeComponent)

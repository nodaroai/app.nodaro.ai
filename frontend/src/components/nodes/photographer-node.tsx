"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Camera } from "lucide-react"
import { getPhotographer, getPhotographerLabel } from "@nodaro-shared/photographer"
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PhotographerData } from "@/types/nodes"

function PhotographerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PhotographerData
  const ids = pickIds(nodeData.photographer)
  const primaryId = ids[0] || "tim-walker"
  const extraIds = ids.slice(1)
  const photographer = getPhotographer(primaryId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Camera />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getPhotographerLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getPhotographerLabel(extraId)}
        </p>
      ))}
      {photographer?.description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {photographer.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PhotographerNode = memo(PhotographerNodeComponent)

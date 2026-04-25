"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Camera } from "lucide-react"
import { getPhotographer, getPhotographerLabel } from "@nodaro-shared/photographer"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PhotographerData } from "@/types/nodes"

function PhotographerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PhotographerData
  const photographerId = nodeData.photographer || "tim-walker"
  const photographer = getPhotographer(photographerId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Camera />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getPhotographerLabel(photographerId)}
      </p>
      {photographer?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {photographer.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PhotographerNode = memo(PhotographerNodeComponent)

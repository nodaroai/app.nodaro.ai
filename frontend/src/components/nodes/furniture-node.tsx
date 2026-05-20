"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Armchair } from "lucide-react"
import { getFurniture, getFurnitureLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { FurnitureData } from "@/types/nodes"

function FurnitureNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as FurnitureData
  const furnitureId = nodeData.furniture || "sofa"
  const furniture = getFurniture(furnitureId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Armchair />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getFurnitureLabel(furnitureId)}
      </p>
      {furniture?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {furniture.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const FurnitureNode = memo(FurnitureNodeComponent)

"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Layers } from "lucide-react"
import { getMaterial, getMaterialLabel } from "@nodaro-shared/materials"
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import { MaterialPreview } from "@/components/editor/config-panels/material-preview"
import type { MaterialData } from "@/types/nodes"

function MaterialNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MaterialData
  const ids = pickIds(nodeData.material)
  const primaryId = ids[0] || "silk"
  const extraIds = ids.slice(1)
  const description = getMaterial(primaryId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Layers />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getMaterialLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getMaterialLabel(extraId)}
        </p>
      ))}
      <MaterialPreview materialId={primaryId} className="w-full aspect-[16/9]" />
      {description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const MaterialNode = memo(MaterialNodeComponent)

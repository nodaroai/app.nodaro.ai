"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Layers } from "lucide-react"
import { getMaterial, getMaterialLabel } from "@nodaro-shared/materials"
import { ParameterNodeShell } from "./parameter-node-shell"
import { MaterialPreview } from "@/components/editor/config-panels/material-preview"
import type { MaterialData } from "@/types/nodes"

function MaterialNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MaterialData
  const materialId = nodeData.material || "silk"
  const description = getMaterial(materialId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Layers />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getMaterialLabel(materialId)}
      </p>
      <MaterialPreview materialId={materialId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const MaterialNode = memo(MaterialNodeComponent)

"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { CloudFog } from "lucide-react"
import { getAtmosphere, getAtmosphereLabel } from "@nodaro/shared"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { AtmospherePreview } from "@/components/editor/config-panels/atmosphere-preview"
import type { AtmosphereData } from "@/types/nodes"

function AtmosphereNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AtmosphereData
  const ids = pickIds(nodeData.atmosphere)
  const primaryId = ids[0] || "clear"
  const extraIds = ids.slice(1)
  const description = getAtmosphere(primaryId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<CloudFog />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getAtmosphereLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getAtmosphereLabel(extraId)}
        </p>
      ))}
      <AtmospherePreview atmosphereId={primaryId} className="w-full aspect-[16/9]" />
      {description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AtmosphereNode = memo(AtmosphereNodeComponent)

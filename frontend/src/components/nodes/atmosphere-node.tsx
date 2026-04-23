"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { CloudFog } from "lucide-react"
import { getAtmosphere, getAtmosphereLabel } from "@nodaro-shared/atmosphere"
import { ParameterNodeShell } from "./parameter-node-shell"
import { AtmospherePreview } from "@/components/editor/config-panels/atmosphere-preview"
import type { AtmosphereData } from "@/types/nodes"

function AtmosphereNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AtmosphereData
  const atmosphereId = nodeData.atmosphere || "clear"
  const description = getAtmosphere(atmosphereId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<CloudFog />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getAtmosphereLabel(atmosphereId)}
      </p>
      <AtmospherePreview atmosphereId={atmosphereId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AtmosphereNode = memo(AtmosphereNodeComponent)

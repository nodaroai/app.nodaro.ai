"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { CloudFog } from "lucide-react"
import { getAtmosphere, getAtmosphereLabel } from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LookPreviewStyleSwitch } from "./look-preview-style"
import { AtmospherePreview, LookArt } from "@/lib/picker-ui"
import type { AtmosphereData } from "@/types/nodes"

function AtmosphereNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AtmosphereData
  const ids = pickIds(nodeData.atmosphere)
  const primaryId = ids[0] || "clear"
  const extraIds = ids.slice(1)
  const description = getAtmosphere(primaryId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<CloudFog />} handleId="out" selected={selected} fluidWidth>
      <div className="flex items-start justify-between gap-2">
        <p className="text-foreground text-sm font-medium min-w-0">
          {getAtmosphereLabel(primaryId)}
        </p>
        <LookPreviewStyleSwitch pickerKey="atmosphere" />
      </div>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getAtmosphereLabel(extraId)}
        </p>
      ))}
      <LookArt pickerKey="atmosphere" id={primaryId} className="w-full aspect-[16/9]" width={640} fallback={<AtmospherePreview atmosphereId={primaryId} className="w-full aspect-[16/9]" />} />
      {description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AtmosphereNode = memo(AtmosphereNodeComponent)

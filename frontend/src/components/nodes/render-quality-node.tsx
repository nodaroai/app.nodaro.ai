"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Cpu } from "lucide-react"
import { getRenderQuality, getRenderQualityLabel } from "@nodaro-shared/render-quality"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { RenderQualityData } from "@/types/nodes"

function RenderQualityNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RenderQualityData
  const renderId = nodeData.renderQuality || "raytracing"
  const description = getRenderQuality(renderId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Cpu />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getRenderQualityLabel(renderId)}
      </p>
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const RenderQualityNode = memo(RenderQualityNodeComponent)

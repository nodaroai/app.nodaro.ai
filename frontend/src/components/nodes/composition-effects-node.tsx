"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Wand2 } from "lucide-react"
import { getCompositionEffect, getCompositionEffectLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { CompositionEffectsData } from "@/types/nodes"

function CompositionEffectsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CompositionEffectsData
  const effectId = nodeData.compositionEffect || "bursting-through-frame"
  const description = getCompositionEffect(effectId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Wand2 />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getCompositionEffectLabel(effectId)}
      </p>
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const CompositionEffectsNode = memo(CompositionEffectsNodeComponent)

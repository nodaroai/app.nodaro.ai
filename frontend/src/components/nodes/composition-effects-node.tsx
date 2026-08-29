"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Wand2 } from "lucide-react"
import { getCompositionEffect, getCompositionEffectLabel } from "@nodaro/prompts"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { CompositionEffectsData } from "@/types/nodes"

function CompositionEffectsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CompositionEffectsData
  // "none" is the neutral catalog entry (empty promptHint), so an unconfigured
  // node reads as None and injects nothing. A node saved with an empty value
  // lands on it too.
  const effectId = nodeData.compositionEffect || "none"
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

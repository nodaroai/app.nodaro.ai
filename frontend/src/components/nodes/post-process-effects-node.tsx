"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import { getPostProcessEffect, getPostProcessEffectLabel } from "@nodaro-shared/post-process-effects"
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PostProcessEffectsData } from "@/types/nodes"

function PostProcessEffectsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PostProcessEffectsData
  const ids = pickIds(nodeData.postProcess)
  const primaryId = ids[0] || "vignette-soft"
  const extraIds = ids.slice(1)
  const description = getPostProcessEffect(primaryId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Sparkles />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getPostProcessEffectLabel(primaryId)}
      </p>
      {extraIds.map((extraId) => (
        <p key={extraId} className="text-foreground/80 text-xs leading-tight">
          <span className="text-muted-foreground">+ </span>
          {getPostProcessEffectLabel(extraId)}
        </p>
      ))}
      {description && extraIds.length === 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PostProcessEffectsNode = memo(PostProcessEffectsNodeComponent)

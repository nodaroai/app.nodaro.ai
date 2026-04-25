"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Sparkles } from "lucide-react"
import { getPostProcessEffect, getPostProcessEffectLabel } from "@nodaro-shared/post-process-effects"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PostProcessEffectsData } from "@/types/nodes"

function PostProcessEffectsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PostProcessEffectsData
  const effectId = nodeData.postProcess || "vignette-soft"
  const description = getPostProcessEffect(effectId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Sparkles />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getPostProcessEffectLabel(effectId)}
      </p>
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PostProcessEffectsNode = memo(PostProcessEffectsNodeComponent)

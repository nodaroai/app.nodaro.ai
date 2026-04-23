"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Brush } from "lucide-react"
import { getStyle, getStyleLabel } from "@nodaro-shared/style"
import { ParameterNodeShell } from "./parameter-node-shell"
import { StylePreview } from "@/components/editor/config-panels/style-preview"
import type { StyleData } from "@/types/nodes"

function StyleNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StyleData
  const styleId = nodeData.style || "cinematic"
  const description = getStyle(styleId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Brush />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getStyleLabel(styleId)}
      </p>
      <StylePreview styleId={styleId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const StyleNode = memo(StyleNodeComponent)

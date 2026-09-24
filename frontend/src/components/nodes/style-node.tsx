"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Brush } from "lucide-react"
import { getStyle, getStyleLabel } from "@nodaro/prompts"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LookPreviewStyleSwitch } from "./look-preview-style"
import { LookArt, StylePreview } from "@/lib/picker-ui"
import type { StyleData } from "@/types/nodes"

function StyleNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StyleData
  const styleId = nodeData.style || "cinematic"
  const description = getStyle(styleId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Brush />} handleId="out" selected={selected} fluidWidth>
      <div className="flex items-start justify-between gap-2">
        <p className="text-foreground text-sm font-medium min-w-0">
          {getStyleLabel(styleId)}
        </p>
        <LookPreviewStyleSwitch pickerKey="style" />
      </div>
      <LookArt
        pickerKey="style"
        id={styleId}
        className="w-full aspect-[16/9]"
        width={640}
        fallback={<StylePreview styleId={styleId} className="w-full aspect-[16/9]" />}
      />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const StyleNode = memo(StyleNodeComponent)

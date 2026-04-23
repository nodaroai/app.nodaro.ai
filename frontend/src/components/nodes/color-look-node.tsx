"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { SwatchBook } from "lucide-react"
import { getColorLook, getColorLookLabel } from "@nodaro-shared/color-look"
import { ParameterNodeShell } from "./parameter-node-shell"
import { ColorLookPreview } from "@/components/editor/config-panels/color-look-preview"
import type { ColorLookData } from "@/types/nodes"

function ColorLookNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ColorLookData
  const colorLookId = nodeData.colorLook || "warm"
  const description = getColorLook(colorLookId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<SwatchBook />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getColorLookLabel(colorLookId)}
      </p>
      <ColorLookPreview colorLookId={colorLookId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const ColorLookNode = memo(ColorLookNodeComponent)

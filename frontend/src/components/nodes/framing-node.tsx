"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Frame } from "lucide-react"
import { getFraming, getFramingLabel } from "@nodaro-shared/framing"
import { ParameterNodeShell } from "./parameter-node-shell"
import { FramingPreview } from "@/components/editor/config-panels/framing-preview"
import type { FramingData } from "@/types/nodes"

function FramingNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as FramingData
  const framingId = nodeData.framing || "medium-shot"
  const description = getFraming(framingId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Frame />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getFramingLabel(framingId)}
      </p>
      <FramingPreview framingId={framingId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const FramingNode = memo(FramingNodeComponent)

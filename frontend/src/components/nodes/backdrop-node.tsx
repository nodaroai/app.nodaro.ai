"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { LayoutDashboard } from "lucide-react"
import { getBackdrop, getBackdropLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { BackdropSwatch } from "@/components/editor/config-panels/backdrop-swatch"
import type { BackdropData } from "@/types/nodes"

function BackdropNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as BackdropData
  const backdropId = nodeData.backdrop || "white-seamless"
  const description = getBackdrop(backdropId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<LayoutDashboard />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getBackdropLabel(backdropId)}
      </p>
      <BackdropSwatch backdropId={backdropId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const BackdropNode = memo(BackdropNodeComponent)

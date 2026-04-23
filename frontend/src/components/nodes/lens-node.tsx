"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Aperture } from "lucide-react"
import { getLens, getLensLabel } from "@nodaro-shared/lens"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LensPreview } from "@/components/editor/config-panels/lens-preview"
import type { LensData } from "@/types/nodes"

function LensNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LensData
  const lensId = nodeData.lens || "normal-50mm"
  const description = getLens(lensId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Aperture />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getLensLabel(lensId)}
      </p>
      <LensPreview lensId={lensId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const LensNode = memo(LensNodeComponent)

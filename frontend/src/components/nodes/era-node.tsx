"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Hourglass } from "lucide-react"
import { getEra, getEraLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { EraData } from "@/types/nodes"

function EraNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as EraData
  const eraId = nodeData.era || "1990s-mall"
  const era = getEra(eraId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Hourglass />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getEraLabel(eraId)}
      </p>
      {era?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {era.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const EraNode = memo(EraNodeComponent)

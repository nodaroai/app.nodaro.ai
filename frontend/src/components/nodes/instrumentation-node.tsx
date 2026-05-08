"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Piano } from "lucide-react"
import {
  getInstrument, getProductionStyle, getVocalPresence, getSingingStyle,
  buildInstrumentationHints, pickIds,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { InstrumentationData } from "@/types/nodes"

function InstrumentationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as InstrumentationData
  const inst = (nodeData.instruments ?? []).map((id) => getInstrument(id)?.label).filter(Boolean) as string[]
  const summary = inst.length > 0 ? inst.slice(0, 3).join(", ") + (inst.length > 3 ? ` +${inst.length - 3}` : "") : "Instrumentation"
  const composed = buildInstrumentationHints(nodeData)

  // Vocal presence + singing style are multi-pick; show all (or "+N more").
  const vocalLabels = pickIds(nodeData.vocalPresence)
    .map((id) => getVocalPresence(id)?.label)
    .filter(Boolean) as string[]
  const styleLabels = pickIds(nodeData.singingStyle)
    .map((id) => getSingingStyle(id)?.label)
    .filter(Boolean) as string[]
  const productionLabel = getProductionStyle(nodeData.production)?.label
  const detailParts: string[] = []
  if (productionLabel) detailParts.push(productionLabel)
  if (vocalLabels.length > 0) {
    const v = vocalLabels.slice(0, 2).join(", ") + (vocalLabels.length > 2 ? ` +${vocalLabels.length - 2}` : "")
    detailParts.push(v)
  }
  if (styleLabels.length > 0) {
    const s = styleLabels.slice(0, 2).join(", ") + (styleLabels.length > 2 ? ` +${styleLabels.length - 2}` : "")
    detailParts.push(s)
  }

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Piano />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {detailParts.length > 0 && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {detailParts.join(" / ")}
        </p>
      )}
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const InstrumentationNode = memo(InstrumentationNodeComponent)

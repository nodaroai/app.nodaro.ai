"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Piano } from "lucide-react"
import {
  getInstrument, getProductionStyle, getVocalPresence,
  buildInstrumentationHints,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { InstrumentationData } from "@/types/nodes"

function InstrumentationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as InstrumentationData
  const inst = (nodeData.instruments ?? []).map((id) => getInstrument(id)?.label).filter(Boolean) as string[]
  const summary = inst.length > 0 ? inst.slice(0, 3).join(", ") + (inst.length > 3 ? ` +${inst.length - 3}` : "") : "Instrumentation"
  const composed = buildInstrumentationHints(nodeData)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Piano />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {(getProductionStyle(nodeData.production) || getVocalPresence(nodeData.vocalPresence)) && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {[getProductionStyle(nodeData.production)?.label, getVocalPresence(nodeData.vocalPresence)?.label].filter(Boolean).join(" / ")}
        </p>
      )}
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const InstrumentationNode = memo(InstrumentationNodeComponent)

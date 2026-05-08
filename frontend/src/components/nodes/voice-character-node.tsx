"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { User } from "lucide-react"
import {
  getVoiceAge, getVoiceGender, getVoiceAccent, getVoiceTimbre,
  buildVoiceCharacterHints,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { VoiceCharacterData } from "@/types/nodes"

function VoiceCharacterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VoiceCharacterData
  const summary = [
    getVoiceAge(nodeData.age)?.label,
    getVoiceGender(nodeData.gender)?.label,
    getVoiceTimbre(nodeData.timbre)?.label,
    getVoiceAccent(nodeData.accent)?.label,
  ].filter(Boolean).join(" / ") || "Voice Character"
  const composed = buildVoiceCharacterHints(nodeData)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<User />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const VoiceCharacterNode = memo(VoiceCharacterNodeComponent)

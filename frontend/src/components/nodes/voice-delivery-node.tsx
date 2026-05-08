"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { MessageCircle } from "lucide-react"
import {
  getVoicePace, getVoiceEmotion, getVoiceArchetype,
  buildVoiceDeliveryHints,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { VoiceDeliveryData } from "@/types/nodes"

function VoiceDeliveryNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VoiceDeliveryData
  const summary = [
    getVoicePace(nodeData.pace)?.label,
    getVoiceArchetype(nodeData.archetype)?.label,
    getVoiceEmotion(nodeData.emotion)?.label,
  ].filter(Boolean).join(" / ") || "Voice Delivery"
  const composed = buildVoiceDeliveryHints(nodeData)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<MessageCircle />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const VoiceDeliveryNode = memo(VoiceDeliveryNodeComponent)

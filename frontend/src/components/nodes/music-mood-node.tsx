"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Activity } from "lucide-react"
import {
  getMusicEnergy, getMusicEmotion, getMusicVibe,
  buildMusicMoodHints,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MusicMoodData } from "@/types/nodes"

function MusicMoodNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MusicMoodData
  const e = getMusicEnergy(nodeData.energy)
  const m = getMusicEmotion(Array.isArray(nodeData.emotion) ? nodeData.emotion[0] : nodeData.emotion)
  const v = getMusicVibe(Array.isArray(nodeData.vibe) ? nodeData.vibe[0] : nodeData.vibe)
  const composed = buildMusicMoodHints(nodeData)
  const summary = [e?.label, m?.label, v?.label].filter(Boolean).join(" / ") || "Music Mood"

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Activity />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const MusicMoodNode = memo(MusicMoodNodeComponent)

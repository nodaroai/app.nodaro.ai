"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Activity } from "lucide-react"
import {
  getMusicEnergy, getMusicEmotion, getMusicVibe,
  buildMusicMoodHints, pickIds,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MusicMoodData } from "@/types/nodes"

function MusicMoodNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MusicMoodData
  const e = getMusicEnergy(nodeData.energy)
  const emotionLabels = pickIds(nodeData.emotion).map((id) => getMusicEmotion(id)?.label).filter((l): l is string => !!l)
  const vibeLabels = pickIds(nodeData.vibe).map((id) => getMusicVibe(id)?.label).filter((l): l is string => !!l)
  const composed = buildMusicMoodHints(nodeData)
  const summary = [e?.label, ...emotionLabels, ...vibeLabels].filter(Boolean).join(" / ") || "Music Mood"

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Activity />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">{summary}</p>
      {composed && <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>}
    </ParameterNodeShell>
  )
}

export const MusicMoodNode = memo(MusicMoodNodeComponent)

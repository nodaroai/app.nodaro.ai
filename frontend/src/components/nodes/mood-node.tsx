"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Smile } from "lucide-react"
import { getMood, getMoodLabel } from "@nodaro-shared/mood"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MoodData } from "@/types/nodes"

function MoodNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MoodData
  const moodId = nodeData.mood || "calm"
  const description = getMood(moodId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Smile />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getMoodLabel(moodId)}
      </p>
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const MoodNode = memo(MoodNodeComponent)

"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Smile } from "lucide-react"
import { getMood, getMoodLabel } from "@nodaro-shared/mood"
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import { MoodEmoji } from "@/components/editor/config-panels/mood-emoji"
import type { MoodData } from "@/types/nodes"

function MoodNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MoodData
  const ids = pickIds(nodeData.mood)
  const primaryId = ids[0] || "calm"
  const extraIds = ids.slice(1)
  const description = getMood(primaryId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Smile />} handleId="out" selected={selected} fluidWidth>
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-foreground text-sm font-medium truncate">
            {getMoodLabel(primaryId)}
          </p>
          {extraIds.map((extraId) => (
            <p key={extraId} className="text-foreground/80 text-xs leading-tight truncate">
              <span className="text-muted-foreground">+ </span>
              {getMoodLabel(extraId)}
            </p>
          ))}
          {description && extraIds.length === 0 && (
            <p className="text-muted-foreground text-[11px] leading-snug">
              {description}
            </p>
          )}
        </div>
        <MoodEmoji moodId={primaryId} className="size-8 shrink-0" />
      </div>
    </ParameterNodeShell>
  )
}

export const MoodNode = memo(MoodNodeComponent)

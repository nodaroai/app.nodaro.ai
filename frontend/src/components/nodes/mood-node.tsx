"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Smile } from "lucide-react"
import { getMood, getMoodLabel } from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LookArt, MoodEmoji, readLookPreviewStyle, useLookPreviewUrl } from "@/lib/picker-ui"
import { LookPreviewStyleSwitch } from "./look-preview-style"
import type { MoodData } from "@/types/nodes"

function MoodNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MoodData
  const ids = pickIds(nodeData.mood)
  const primaryId = ids[0] || "calm"
  const extraIds = ids.slice(1)
  const description = getMood(primaryId)?.description
  // With a rendered preview the node shows it full width (the same picture as
  // the picker tile); without one — or switched to the illustration — it keeps
  // the emoji beside the label. Read off the node's own data: this body renders
  // outside the shell's preview-style scope.
  const registered = useLookPreviewUrl("mood", primaryId) !== undefined
  const hasArt = registered && readLookPreviewStyle(nodeData) === "real"

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Smile />} handleId="out" selected={selected} fluidWidth>
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-foreground text-sm font-medium truncate min-w-0">
              {getMoodLabel(primaryId)}
            </p>
            <LookPreviewStyleSwitch pickerKey="mood" />
          </div>
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
        {!hasArt && <MoodEmoji moodId={primaryId} className="size-8 shrink-0" />}
      </div>
      {hasArt && (
        <LookArt
          pickerKey="mood"
          id={primaryId}
          className="w-full aspect-[16/9]"
          width={640}
          fallback={<MoodEmoji moodId={primaryId} className="size-8 shrink-0" />}
        />
      )}
    </ParameterNodeShell>
  )
}

export const MoodNode = memo(MoodNodeComponent)

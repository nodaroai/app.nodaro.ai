"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Sparkles, User } from "lucide-react"
import { getCharacterFx, getCharacterFxLabel, pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleIcon } from "./handle-icon"
import type { CharacterFxData } from "@/types/nodes"

const TARGET_TOP = "calc(100% - 25px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
const INPUT_HANDLES = [
  { id: "target", type: "target" as const, position: Position.Left, customStyle: { top: TARGET_TOP, left: "-29px" }, hideHandle: true },
]

const EXTRA_HANDLE_ICONS = (
  <HandleIcon icon={<User />} color="indigo" side="left" top={TARGET_TOP} label="Target subject" />
)

function CharacterFxNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CharacterFxData
  const ids = pickIds(nodeData.characterFx)
  const primaryId = ids[0] ?? "auto"
  const isMulti = ids.length >= 2
  const primaryLabel = getCharacterFxLabel(primaryId)
  const labelText = isMulti
    ? `${primaryLabel} + ${getCharacterFxLabel(ids[1])}`
    : primaryLabel
  const description = getCharacterFx(primaryId)?.description

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Sparkles />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={INPUT_HANDLES}
      extraHandleIcons={EXTRA_HANDLE_ICONS}
    >
      <p className="text-foreground text-sm font-medium">{labelText}</p>
      {description && !isMulti && (
        <p className="text-muted-foreground text-[11px] leading-snug">{description}</p>
      )}
      {isMulti && (
        <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff0073] px-1 text-[10px] font-bold text-white">
          2
        </span>
      )}
    </ParameterNodeShell>
  )
}

export const CharacterFxNode = memo(CharacterFxNodeComponent)

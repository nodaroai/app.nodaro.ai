"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Sparkles, Users } from "lucide-react"
import { getCharacterFx, getCharacterFxLabel, pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleWithPopover } from "./handle-with-popover"
import { ACCEPTS_CHARACTER_REF } from "@/lib/target-handle-registry"
import type { HandleConfig } from "./base-node"
import type { CharacterFxData } from "@/types/nodes"

const TARGET_TOP = "calc(100% - 25px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
// `external: true` — BaseNode counts this for sizing but doesn't render it;
// the typed pip is owned by <HandleWithPopover> below (matches the pattern in
// camera-motion-node + transition-node + generate-image-node).
const INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "target", type: "target", position: Position.Left, customStyle: { top: TARGET_TOP, left: "-29px" }, hideHandle: true, external: true },
]

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
      extraHandleIcons={
        <HandleWithPopover
          nodeId={id}
          handleId="target"
          nodeType="character-fx"
          type="target"
          position={Position.Left}
          label="Target subject"
          color="#F472B6"
          icon={<Users className="w-3.5 h-3.5" />}
          accepts={ACCEPTS_CHARACTER_REF}
          side="left"
          top={TARGET_TOP}
          // Single ambiguous input pip — without the always-visible label
          // it's unclear what wires connect here at rest (the picker
          // accepts identity refs, not arbitrary upstream output).
          alwaysShowLabel
        />
      }
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

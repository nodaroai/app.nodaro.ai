"use client"

import { useT } from "@/lib/i18n"
import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Footprints, UserPlus, Users } from "lucide-react"
import { getCharacterMotion, getCharacterMotionLabel } from "@nodaro/prompts/pickers"
import { pickIds } from "@nodaro/shared/catalogs"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_CHARACTER_REF } from "@/lib/target-handle-registry"
import type { HandleConfig } from "./base-node"
import type { CharacterMotionData } from "@/types/nodes"

const TARGET_TOP = "calc(100% - 60px)"
const PARTNER_TOP = "calc(100% - 25px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
// `external: true` — BaseNode counts these for sizing but the typed pips are
// owned by the <HandleWithPopover>s below (the camera-motion / character-fx pattern).
const INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "target",  type: "target", position: Position.Left, customStyle: { top: TARGET_TOP,  left: "-29px" }, hideHandle: true, external: true },
  { id: "partner", type: "target", position: Position.Left, customStyle: { top: PARTNER_TOP, left: "-29px" }, hideHandle: true, external: true },
]

/** Card title for the ordered picks: "A", "A + B", or "A + 2" for three. */
export function characterMotionCardTitle(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) return getCharacterMotionLabel("auto")
  const first = getCharacterMotionLabel(ids[0])
  if (ids.length === 1) return first
  if (ids.length === 2) return `${first} + ${getCharacterMotionLabel(ids[1])}`
  return `${first} + ${ids.length - 1}`
}

function CharacterMotionNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CharacterMotionData
  const ids = pickIds(nodeData.characterMotion)
  const description = ids.length === 1 ? getCharacterMotion(ids[0])?.description : undefined

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Footprints />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={INPUT_HANDLES}
      extraHandleIcons={
        <>
          <HandleWithPopover
            nodeId={id}
            handleId="target"
            nodeType="character-motion"
            type="target"
            position={Position.Left}
            label={t("node.targetSubject")}
            color={HANDLE_COLORS.identity}
            icon={<Users className="w-3.5 h-3.5" />}
            accepts={ACCEPTS_CHARACTER_REF}
            side="left"
            top={TARGET_TOP}
            alwaysShowLabel
          />
          <HandleWithPopover
            nodeId={id}
            handleId="partner"
            nodeType="character-motion"
            type="target"
            position={Position.Left}
            label={t("node.partner")}
            color={HANDLE_COLORS.identity}
            icon={<UserPlus className="w-3.5 h-3.5" />}
            accepts={ACCEPTS_CHARACTER_REF}
            side="left"
            top={PARTNER_TOP}
            alwaysShowLabel
          />
        </>
      }
    >
      <p className="text-foreground text-sm font-medium">{characterMotionCardTitle(ids)}</p>
      {description && <p className="text-muted-foreground text-[11px] leading-snug">{description}</p>}
      {ids.length >= 2 && (
        <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-cta px-1 text-[11px] font-bold text-white">
          {ids.length}
        </span>
      )}
    </ParameterNodeShell>
  )
}

export const CharacterMotionNode = memo(CharacterMotionNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { GitBranch, Frame, Sparkles } from "lucide-react"
import { getTransition, getTransitionLabel, pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_PARAMETER_PICKER } from "@/lib/target-handle-registry"
import type { HandleConfig } from "./base-node"
import type { TransitionData } from "@/types/nodes"

// Bottom-left input handle vertical positions (offset from the node's bottom edge).
const END_STATE_TOP   = "calc(100% - 25px)"
const START_STATE_TOP = "calc(100% - 60px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
// `external: true` — BaseNode counts these for sizing but doesn't render them;
// the typed pip is owned by <HandleWithPopover> below (matches the pattern in
// camera-motion-node + generate-image-node + parameter-node-shell's source handle).
const INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "startState", type: "target", position: Position.Left, customStyle: { top: START_STATE_TOP, left: "-29px" }, hideHandle: true, external: true },
  { id: "endState",   type: "target", position: Position.Left, customStyle: { top: END_STATE_TOP,   left: "-29px" }, hideHandle: true, external: true },
]

function TransitionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TransitionData
  const ids = pickIds(nodeData.transition)
  const primaryId = ids[0] ?? "auto"
  const isMulti = ids.length >= 2
  const primaryLabel = getTransitionLabel(primaryId)
  const labelText = isMulti
    ? `${primaryLabel} + ${getTransitionLabel(ids[1])}`
    : primaryLabel
  const description = getTransition(primaryId)?.description

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<GitBranch />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={INPUT_HANDLES}
      extraHandleIcons={
        <>
          <HandleWithPopover
            nodeId={id}
            handleId="startState"
            nodeType="transition"
            type="target"
            position={Position.Left}
            label="Start state"
            color={HANDLE_COLORS.look}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            accepts={ACCEPTS_PARAMETER_PICKER}
            side="left"
            top={START_STATE_TOP}
            // Two input pips are visually identical without their labels.
            // Pin labels visible so users can tell start vs end at rest.
            alwaysShowLabel
          />
          <HandleWithPopover
            nodeId={id}
            handleId="endState"
            nodeType="transition"
            type="target"
            position={Position.Left}
            label="End state"
            color={HANDLE_COLORS.look}
            icon={<Frame className="w-3.5 h-3.5" />}
            accepts={ACCEPTS_PARAMETER_PICKER}
            side="left"
            top={END_STATE_TOP}
            alwaysShowLabel
          />
        </>
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

export const TransitionNode = memo(TransitionNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { GitBranch, Frame, Sparkles } from "lucide-react"
import { getTransition, getTransitionLabel, pickIds } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleIcon } from "./handle-icon"
import type { TransitionData } from "@/types/nodes"

// Bottom-left input handle vertical positions (offset from the node's bottom edge).
const END_STATE_TOP   = "calc(100% - 25px)"
const START_STATE_TOP = "calc(100% - 60px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
const INPUT_HANDLES = [
  { id: "startState", type: "target" as const, position: Position.Left, customStyle: { top: START_STATE_TOP, left: "-29px" }, hideHandle: true },
  { id: "endState",   type: "target" as const, position: Position.Left, customStyle: { top: END_STATE_TOP,   left: "-29px" }, hideHandle: true },
]

const EXTRA_HANDLE_ICONS = (
  <>
    <HandleIcon icon={<Sparkles />} color="indigo" side="left" top={START_STATE_TOP} label="Start state" />
    <HandleIcon icon={<Frame />}    color="indigo" side="left" top={END_STATE_TOP}   label="End state" />
  </>
)

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

export const TransitionNode = memo(TransitionNodeComponent)

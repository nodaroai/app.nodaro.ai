"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video, Frame, Sparkles } from "lucide-react"
import { getCameraMotion, getCameraMotionLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleIcon } from "./handle-icon"
import { CameraMotionPreview } from "@/components/editor/config-panels/camera-motion-preview"
import type { CameraMotionData } from "@/types/nodes"

// Bottom-left input handle vertical positions (offset from the node's bottom edge).
const END_STATE_TOP = "calc(100% - 25px)"
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

function CameraMotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraMotionData
  const motionId = nodeData.cameraMotion || "static"
  const description = getCameraMotion(motionId)?.description

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Video />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={INPUT_HANDLES}
      extraHandleIcons={EXTRA_HANDLE_ICONS}
    >
      <p className="text-foreground text-sm font-medium">
        {getCameraMotionLabel(motionId)}
      </p>
      <CameraMotionPreview motionId={motionId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const CameraMotionNode = memo(CameraMotionNodeComponent)

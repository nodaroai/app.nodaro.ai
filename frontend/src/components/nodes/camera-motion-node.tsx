"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video, Sparkles, Frame } from "lucide-react"
import { getCameraMotion, getCameraMotionLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { CameraMotionPreview } from "@/components/editor/config-panels/camera-motion-preview"
import { ACCEPTS_PARAMETER_PICKER } from "@/lib/target-handle-registry"
import type { HandleConfig } from "./base-node"
import type { CameraMotionData } from "@/types/nodes"

// Bottom-left input handle vertical positions (offset from the node's bottom edge).
const END_STATE_TOP = "calc(100% - 25px)"
const START_STATE_TOP = "calc(100% - 60px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
// `external: true` — BaseNode counts these for sizing but doesn't render them;
// the typed pip is owned by <HandleWithPopover> below (matches the pattern in
// generate-image-node + parameter-node-shell's source handle).
const INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "startState", type: "target", position: Position.Left, customStyle: { top: START_STATE_TOP, left: "-29px" }, hideHandle: true, external: true },
  { id: "endState",   type: "target", position: Position.Left, customStyle: { top: END_STATE_TOP,   left: "-29px" }, hideHandle: true, external: true },
]

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
      extraHandleIcons={
        <>
          <HandleWithPopover
            nodeId={id}
            handleId="startState"
            nodeType="camera-motion"
            type="target"
            position={Position.Left}
            // "Start state" / "End state" — these wires carry prompt-hint
            // fragments, not image frames; the runtime composes a transition
            // between two scene-state descriptions. "Frame" was misleading
            // (no image is expected here) and inconsistent with transition.
            label="Start state"
            color={HANDLE_COLORS.look}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            accepts={ACCEPTS_PARAMETER_PICKER}
            side="left"
            top={START_STATE_TOP}
            // The two input pips are visually identical without their labels
            // (same color, side, and icon difference is subtle). Pin labels
            // visible so users can tell start vs end at rest.
            alwaysShowLabel
          />
          <HandleWithPopover
            nodeId={id}
            handleId="endState"
            nodeType="camera-motion"
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

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video, Frame, Sparkles } from "lucide-react"
import { getCameraMotion, getCameraMotionLabel } from "@nodaro-shared/camera-motions"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CameraMotionPreview } from "@/components/editor/config-panels/camera-motion-preview"
import type { CameraMotionData } from "@/types/nodes"

// Bottom-left input handle vertical positions (offset from the node's bottom edge).
const END_STATE_TOP = "calc(100% - 25px)"
const START_STATE_TOP = "calc(100% - 60px)"

function CameraMotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraMotionData
  const motionId = nodeData.cameraMotion || "static"
  const description = getCameraMotion(motionId)?.description
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  return (
    <div className="relative w-full h-full">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Video />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Video />}
        category="parameter"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={[
          // Two start/end-state target handles on the bottom-left corner. No `label`
          // so BaseNode doesn't render a label inside the node body — labels float
          // outside via HandleIcon (see below).
          { id: "startState", type: "target", position: Position.Left, customStyle: { top: START_STATE_TOP, left: "-29px" }, hideHandle: true },
          { id: "endState",   type: "target", position: Position.Left, customStyle: { top: END_STATE_TOP,   left: "-29px" }, hideHandle: true },
          // Output handle on the right, top of the node (existing position).
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "20px", right: "-29px" }, hideHandle: true },
        ]}
      >
        <div className="px-3 py-3 flex flex-col gap-2 h-full">
          <p className="text-foreground text-sm font-medium">
            {getCameraMotionLabel(motionId)}
          </p>
          <CameraMotionPreview motionId={motionId} className="w-full aspect-[16/9]" />
          {description && (
            <p className="text-muted-foreground text-[11px] leading-snug">
              {description}
            </p>
          )}
        </div>
      </BaseNode>
      {/* Visible handle indicators with labels rendered OUTSIDE the node frame. */}
      <HandleIcon icon={<Video />}    color="indigo" side="right" top="20px" />
      <HandleIcon icon={<Sparkles />} color="indigo" side="left"  top={START_STATE_TOP} label="Start state" />
      <HandleIcon icon={<Frame />}    color="indigo" side="left"  top={END_STATE_TOP}   label="End state" />
    </div>
  )
}

export const CameraMotionNode = memo(CameraMotionNodeComponent)

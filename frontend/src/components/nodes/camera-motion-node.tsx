"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Video } from "lucide-react"
import { getCameraMotionLabel } from "@nodaro-shared/camera-motions"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { CameraMotionData } from "@/types/nodes"

function CameraMotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraMotionData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Video />} handleId="out" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {getCameraMotionLabel(nodeData.cameraMotion)}
      </p>
    </ParameterNodeShell>
  )
}

export const CameraMotionNode = memo(CameraMotionNodeComponent)

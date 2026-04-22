"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Video } from "lucide-react"
import { getCameraMotion, getCameraMotionLabel } from "@nodaro-shared/camera-motions"
import { ParameterNodeShell } from "./parameter-node-shell"
import { CameraMotionPreview } from "@/components/editor/config-panels/camera-motion-preview"
import type { CameraMotionData } from "@/types/nodes"

function CameraMotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraMotionData
  const motionId = nodeData.cameraMotion || "static"
  const description = getCameraMotion(motionId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Video />} handleId="out" selected={selected} fluidWidth>
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

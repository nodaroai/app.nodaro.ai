"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video } from "lucide-react"
import { BaseNode } from "./base-node"
import type { CameraMotionData } from "@/types/nodes"

function CameraMotionNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraMotionData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Video className="h-4 w-4" />}
      category="parameter"
      credits={0}
      selected={selected}
      handles={[
        { id: "out", type: "source", position: Position.Right, label: "Camera" },
      ]}
    >
      <p className="text-muted-foreground">
        {nodeData.cameraMotion}
      </p>
    </BaseNode>
  )
}

export const CameraMotionNode = memo(CameraMotionNodeComponent)

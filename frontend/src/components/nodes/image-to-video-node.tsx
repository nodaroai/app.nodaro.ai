"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ImageToVideoData } from "@/types/nodes"

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Film className="h-4 w-4" />}
      category="ai"
      credits={20}
      selected={selected}
      handles={[
        { id: "image", type: "target", position: Position.Left, label: "Image", top: "14%" },
        { id: "motion_prompt", type: "target", position: Position.Left, label: "Motion", top: "28%" },
        { id: "video_provider", type: "target", position: Position.Left, label: "Provider", top: "42%" },
        { id: "duration", type: "target", position: Position.Left, label: "Duration", top: "56%" },
        { id: "motion", type: "target", position: Position.Left, label: "Motion Style", top: "70%" },
        { id: "camera_motion", type: "target", position: Position.Left, label: "Camera", top: "84%" },
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-1 text-muted-foreground">
        <span>Provider: {nodeData.provider}</span>
        <span>Duration: {nodeData.duration}s</span>
        <span>Motion: {nodeData.motion}</span>
      </div>
    </BaseNode>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)

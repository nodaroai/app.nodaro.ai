"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Video } from "lucide-react"
import { BaseNode } from "./base-node"
import type { UploadVideoData } from "@/types/nodes"

function UploadVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadVideoData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Video className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.url || nodeData.assetId || "No video selected"}
      </p>
    </BaseNode>
  )
}

export const UploadVideoNode = memo(UploadVideoNodeComponent)

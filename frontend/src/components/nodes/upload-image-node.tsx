"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon } from "lucide-react"
import { BaseNode } from "./base-node"
import type { UploadImageData } from "@/types/nodes"

function UploadImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as UploadImageData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "image", type: "source", position: Position.Right, label: "Image" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.url || nodeData.assetId || "No image selected"}
      </p>
    </BaseNode>
  )
}

export const UploadImageNode = memo(UploadImageNodeComponent)

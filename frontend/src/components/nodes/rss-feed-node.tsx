"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Rss } from "lucide-react"
import { BaseNode } from "./base-node"
import type { RSSFeedData } from "@/types/nodes"

function RSSFeedNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RSSFeedData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Rss className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "text", type: "source", position: Position.Right, label: "Text", top: "40%" },
        { id: "image", type: "source", position: Position.Right, label: "Image", top: "70%" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.feedUrl || "Enter feed URL..."}
      </p>
    </BaseNode>
  )
}

export const RSSFeedNode = memo(RSSFeedNodeComponent)

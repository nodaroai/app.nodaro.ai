"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { List } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ListNodeData } from "@/types/nodes"

function ListNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ListNodeData
  const itemCount = nodeData.items
    ? nodeData.items.split("\n").filter((line) => line.trim() !== "").length
    : 0

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<List className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "list", type: "source", position: Position.Right, label: "List" },
      ]}
    >
      <p className="text-sm text-muted-foreground">
        {itemCount > 0 ? `${itemCount} item${itemCount !== 1 ? "s" : ""}` : "No items yet"}
      </p>
    </BaseNode>
  )
}

export const ListNode = memo(ListNodeComponent)

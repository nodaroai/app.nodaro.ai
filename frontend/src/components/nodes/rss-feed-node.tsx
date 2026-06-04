"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Rss, Type, ImageIcon } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { RSSFeedData } from "@/types/nodes"

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, hideHandle: true },
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, hideHandle: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: '50px', right: '-29px' }, hideHandle: true },
] as const

function RSSFeedNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RSSFeedData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Rss className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Rss className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3">
          <p className="text-muted-foreground truncate max-w-[180px]">
            {nodeData.feedUrl || "Enter feed URL..."}
          </p>
        </div>
      </BaseNode>
      <HandleIcon icon={<Rss />} color="cyan" side="left" top="calc(100% - 24px)" />
      <HandleIcon icon={<Type />} top="24px" />
      <HandleIcon icon={<ImageIcon />} top="50px" />
    </div>
  )
}

export const RSSFeedNode = memo(RSSFeedNodeComponent)

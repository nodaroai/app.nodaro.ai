"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Send } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { TelegramTriggerData } from "@/types/nodes"

const ICON = <Send className="h-4 w-4" />

function TelegramTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TelegramTriggerData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Send className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={ICON}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={[
          {
            id: "in",
            type: "target",
            position: Position.Left,
            customStyle: { top: "50%", left: "-29px" },
            hideHandle: true,
          },
          {
            id: "out",
            type: "source",
            position: Position.Right,
            top: "50%",
          },
        ]}
      >
        <div className="p-3">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {nodeData.isActive ? "Listening for messages" : "Configure Telegram trigger..."}
          </p>
          {nodeData.isActive !== undefined && (
            <p className={`text-[10px] mt-1 ${nodeData.isActive ? "text-green-500" : "text-muted-foreground"}`}>
              {nodeData.isActive ? "Active" : "Inactive"}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleIcon icon={<Send />} color="cyan" side="left" />
      <HandleIcon icon={<Send />} top="50%" />
    </div>
  )
}

export const TelegramTriggerNode = memo(TelegramTriggerNodeComponent)

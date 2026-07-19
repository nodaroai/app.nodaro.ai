"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Rss } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import type { TelegramChannelFeedData } from "@/types/nodes"

const ICON = <Rss className="h-4 w-4" />

function TelegramChannelFeedNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TelegramChannelFeedData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const credits = useModelCredits("telegram-channel-feed", 1)

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Rss className="w-3.5 h-3.5" />}
        onSave={(newLabel) => useWorkflowStore.getState().updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={ICON}
        category="input"
        credits={credits}
        selected={selected}
        minWidth={240}
        hideHeader
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="p-3">
          {status === "running" ? (
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          ) : status === "failed" && nodeData.errorMessage ? (
            <p className="text-xs text-red-500 line-clamp-3">{nodeData.errorMessage}</p>
          ) : nodeData.generatedText ? (
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{nodeData.generatedText}</p>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {nodeData.channel ? `Reads @${nodeData.channel.replace(/^@/, "")}` : "Set a public channel..."}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="telegram-channel-feed" handleId="out" type="source" position={Position.Right} label="Posts" color={TEXT_HANDLE_COLOR} icon={<Rss />} side="right" top="24px" />
    </div>
  )
}

export const TelegramChannelFeedNode = memo(TelegramChannelFeedNodeComponent)

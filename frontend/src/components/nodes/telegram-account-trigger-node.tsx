"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Send } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { TelegramAccountTriggerData } from "@/types/nodes"

const ICON = <Send className="h-4 w-4" />

/**
 * Telegram account trigger: starts the run when a message arrives in one of
 * the chosen chats of the owner's connected account. The card shows whether
 * it listens and to how many chats; the panel does the choosing.
 */
function TelegramAccountTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as TelegramAccountTriggerData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const chatCount = nodeData.chatIds?.length ?? 0
  const listening = nodeData.isActive === true && !!nodeData.accountId && chatCount > 0

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
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="p-3">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {!nodeData.accountId
              ? t("tgtrig.cardConfigure")
              : listening
                ? t("tgtrig.cardListening", { n: chatCount })
                : t("tgtrig.cardOff")}
          </p>
          <p className={`text-[10px] mt-1 ${listening ? "text-green-500" : "text-muted-foreground"}`}>
            {listening ? t("sched.active") : t("apps.inactive")}
          </p>
        </div>
      </BaseNode>
      {/* A trigger starts the run; it takes nothing from the canvas. */}
      <HandleWithPopover nodeId={id} nodeType="telegram-account-trigger" handleId="out" type="source" position={Position.Right} label="Message" color={TEXT_HANDLE_COLOR} icon={<Send />} side="right" top="24px" />
    </div>
  )
}

export const TelegramAccountTriggerNode = memo(TelegramAccountTriggerNodeComponent)

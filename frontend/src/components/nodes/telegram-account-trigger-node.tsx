"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Link2, Loader2, Send, Type, Video } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { TelegramAccountTriggerData } from "@/types/nodes"

const ICON = <Send className="h-4 w-4" />

/**
 * Where each output sits on the card, top to bottom — the same ids, in the
 * same order, as @nodaro/shared TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES (a
 * test pins it). The message first; then the post a shared link or forward
 * is about.
 */
export const TELEGRAM_ACCOUNT_TRIGGER_CARD_OUTPUTS: ReadonlyArray<{ id: string; top: string }> = [
  { id: "out", top: "24px" },
  { id: "videoLink", top: "50px" },
  { id: "postText", top: "76px" },
  { id: "postLink", top: "102px" },
]
const TOP = Object.fromEntries(TELEGRAM_ACCOUNT_TRIGGER_CARD_OUTPUTS.map((o) => [o.id, o.top])) as Record<string, string>

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
  // The editor follows a run this trigger started (follow-triggered-run.ts): the card says so while it goes.
  const working = nodeData.executionStatus === "running"

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
        isRunning={working}
        minWidth={220}
        hideHeader
        handles={TELEGRAM_ACCOUNT_TRIGGER_CARD_OUTPUTS.map((o) => ({
          id: o.id,
          type: "source" as const,
          position: Position.Right,
          customStyle: { top: o.top, right: "-29px" },
          external: true,
        }))}
      >
        <div className="p-3 min-h-[118px]">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {!nodeData.accountId
              ? t("tgtrig.cardConfigure")
              : listening
                ? t(chatCount === 1 ? "tgtrig.cardListeningOne" : "tgtrig.cardListening", { n: chatCount })
                : t("tgtrig.cardOff")}
          </p>
          <p className={`text-[10px] mt-1 ${listening ? "text-green-500" : "text-muted-foreground"}`}>
            {listening ? t("sched.active") : t("sched.inactive")}
          </p>
          {nodeData.inboxMode === true && <p className="text-[10px] mt-1 text-muted-foreground">{t("tgtrig.cardInbox")}</p>}
          {working && (
            <p className="flex items-center gap-1.5 text-[11px] mt-2 text-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {t("tgtrig.cardHandling")}
            </p>
          )}
        </div>
      </BaseNode>
      {/* A trigger starts the run; it takes nothing from the canvas. */}
      <HandleWithPopover nodeId={id} nodeType="telegram-account-trigger" handleId="out" type="source" position={Position.Right} label="Message" color={TEXT_HANDLE_COLOR} icon={<Send />} side="right" top={TOP.out} />
      <HandleWithPopover nodeId={id} nodeType="telegram-account-trigger" handleId="videoLink" type="source" position={Position.Right} label="Video link" color={TEXT_HANDLE_COLOR} icon={<Video />} side="right" top={TOP.videoLink} />
      <HandleWithPopover nodeId={id} nodeType="telegram-account-trigger" handleId="postText" type="source" position={Position.Right} label="Post text" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top={TOP.postText} />
      <HandleWithPopover nodeId={id} nodeType="telegram-account-trigger" handleId="postLink" type="source" position={Position.Right} label="Post link" color={TEXT_HANDLE_COLOR} icon={<Link2 />} side="right" top={TOP.postLink} />
    </div>
  )
}

export const TelegramAccountTriggerNode = memo(TelegramAccountTriggerNodeComponent)

"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Bot, Loader2, Send, Type, User } from "lucide-react"
import { telegramSendAsOf, telegramSendDestinationOf } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { NODE_CREDIT_COSTS } from "@/components/editor/workflow-editor/types"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/en"
import type { TelegramAccountSendData } from "@/types/nodes"

/**
 * Telegram Reply: says who writes (the owner's account or bot) and where the
 * message lands — always the owner. It runs on the server only, so its Run
 * button is "Run from here"; the card shows the message it sent last.
 */

function TelegramAccountSendNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const d = data as TelegramAccountSendData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  // The price a run is charged (an admin retune included); the table is the cold-cache floor.
  const credits = useModelCredits("telegram-account-send", NODE_CREDIT_COSTS["telegram-account-send"])
  const status = d.executionStatus ?? "idle"
  const running = status === "running"

  const asBot = telegramSendAsOf(d.sendAs) === "bot"
  const fromKey: MessageKey = asBot ? "tgsend.fromBot" : "tgsend.fromAccount"
  const toKey: MessageKey = asBot ? "tgsend.toBotChat" : telegramSendDestinationOf(d.destination) === "saved" ? "tgsend.toSaved" : "tgsend.toReply"
  const configured = !!d.accountId
  const sent = typeof d.generatedText === "string" && d.generatedText.trim() !== "" ? d.generatedText : ""

  return (
    <div className="relative" style={{ maxWidth: "280px" }}>
      <EditableNodeLabel label={d.label} icon={<Send className="w-3.5 h-3.5" />} onSave={(label) => updateNodeData(id, { label })} />
      <BaseNode
        id={id}
        label={d.label}
        icon={<Send className="h-4 w-4" />}
        category="output"
        credits={credits}
        selected={selected}
        isRunning={running}
        hideHeader
        minWidth={260}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runFromHere?.(nid)} runFromHere />}
        handles={[{ id: "in", type: "target", position: Position.Left, customStyle: { top: "24px", left: "-29px" }, external: true }]}
      >
        <div className="flex flex-col gap-1.5 text-xs">
          {configured ? (
            <>
              <div className="flex items-center gap-1.5">
                {asBot ? <Bot className="h-3.5 w-3.5 shrink-0" /> : <User className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{t(fromKey)}</span>
              </div>
              <span className="text-[10.5px] text-muted-foreground">{t(toKey)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("tgsend.cardConfigure")}</span>
          )}
          {running && (
            <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("tgsend.cardSending")}
            </span>
          )}
          {!running && sent && (
            <div className="rounded-md bg-muted/30 p-2">
              <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{t("tgsend.cardSent")}</span>
              <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-[11px] text-foreground/80" dir="auto">
                {sent}
              </p>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover
        nodeId={id}
        nodeType="telegram-account-send"
        handleId="in"
        type="target"
        position={Position.Left}
        label={t("tgsend.handleText")}
        color={HANDLE_COLORS.text}
        icon={<Type />}
        side="left"
        top="24px"
      />
    </div>
  )
}

export const TelegramAccountSendNode = memo(TelegramAccountSendNodeComponent)

"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import { formatDateTime } from "@/lib/i18n/format"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Rss, Type } from "lucide-react"
import { telegramPostsFrom } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useTelegramFeedCursor } from "@/hooks/queries/use-telegram-feed-queries"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import type { TelegramChannelFeedData } from "@/types/nodes"

const ICON = <Rss className="h-4 w-4" />

/**
 * Telegram Channel Feed — reads a public channel's new posts. Two output pips:
 * `json` (the posts — id, link, text, date, media, forwarded from) and `text`
 * (their digest). The card shows where the feed stands (the route-owned
 * position, "Last seen #N"), how many posts the last run brought, and the
 * newest one with its picture.
 */
function TelegramChannelFeedNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as TelegramChannelFeedData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const status = nodeData.executionStatus ?? "idle"
  const credits = useModelCredits("telegram-channel-feed", 10)
  const { data: cursor } = useTelegramFeedCursor(workflowId, id)
  const posts = telegramPostsFrom(nodeData.generatedJson)
  const newest = posts[posts.length - 1]

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
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
        ]}
      >
        <div className="p-3 space-y-1.5">
          {status === "running" ? (
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          ) : status === "failed" && nodeData.errorMessage ? (
            <p className="text-xs text-red-500 line-clamp-3">{nodeData.errorMessage}</p>
          ) : newest ? (
            <>
              <p className="text-[10px] font-medium text-muted-foreground">
                {posts.length === 1 ? t("node.feedNewPostsOne") : t("node.feedNewPosts", { n: posts.length })}
              </p>
              <div className="flex gap-2 items-start">
                {newest.imageUrl && (
                  <CachedImage src={newest.imageUrl} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                )}
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap min-w-0">
                  {newest.text || newest.postUrl}
                </p>
              </div>
            </>
          ) : nodeData.generatedText ? (
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{nodeData.generatedText}</p>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {nodeData.channel ? t("node.readsChannel", { channel: nodeData.channel.replace(/^@/, "") }) : t("node.setPublicChannelPlaceholder")}
            </p>
          )}
          {cursor?.lastSeenId != null && status !== "running" && (
            <p className="text-[10px] text-muted-foreground/80" title={cursor.updatedAt ? formatDateTime(cursor.updatedAt) : undefined}>
              {t("node.feedLastSeen", { id: cursor.lastSeenId })}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="telegram-channel-feed" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="telegram-channel-feed" handleId="text" type="source" position={Position.Right} label="Posts" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="52px" />
    </div>
  )
}

export const TelegramChannelFeedNode = memo(TelegramChannelFeedNodeComponent)

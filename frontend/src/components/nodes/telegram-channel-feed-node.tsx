"use client"

import { memo, useMemo, useState } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Rss, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useTelegramFeedCursor } from "@/hooks/queries/use-telegram-feed-queries"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import type { TelegramChannelFeedData } from "@/types/nodes"
import { deriveTelegramFeedCardState, telegramFeedPosts } from "./telegram-feed-run-state"
import { PostFeedBody, PostFeedDialog } from "./post-feed/post-feed-card"
import { FeedDot, FeedHeaderRow, FeedPlaceholder, FeedRunningSkeleton } from "./post-feed/feed-card-chrome"
import { telegramFeedPost } from "./post-feed/telegram-feed-post"

const WIDTH = 440
const ICON = <Rss className="h-4 w-4" />

// Two stacked outputs. `text` sits first: an edge with no source handle is
// drawn from the first pip, and both engines read such an edge as the text output.
const HANDLES = [
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
] as const

/**
 * Telegram Channel Feed — reads a public channel's new posts. The card is the
 * shared post feed card (`post-feed/`): the newest post featured (picture or
 * video, text, date, views, forwarded-from, a link to the post), arrows and a
 * thumbnail strip over the rest, and "View all" opening every post of the
 * last run in the shared inspector. Two output pips: `text` (the digest) and
 * `json` (the posts).
 */
function TelegramChannelFeedNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as TelegramChannelFeedData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const credits = useModelCredits("telegram-channel-feed", 10)
  const { data: cursor } = useTelegramFeedCursor(workflowId, id, nodeData.channel)

  const state = deriveTelegramFeedCardState(nodeData)
  const running = state.kind === "running"
  const posts = useMemo(() => telegramFeedPosts(nodeData.generatedJson).map((p) => telegramFeedPost(p, t)), [nodeData.generatedJson, t])
  const [allOpen, setAllOpen] = useState(false)

  const channelShown = nodeData.channel ? `@${nodeData.channel.replace(/^@/, "")}` : ""
  const lastSeen = cursor?.lastSeenId ?? null

  const statusRight =
    state.kind === "never-ran" ? (
      <><FeedDot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><FeedDot color="var(--meta-ads-info)" />{t("tgfeed.reading")}</>
    ) : state.kind === "failed" ? (
      <><FeedDot color="#ef4444" /><span className="text-red-500">{t("node.failed")}</span></>
    ) : state.kind === "empty" ? (
      <><FeedDot color="var(--meta-ads-dot-idle)" />{t("tgfeed.nothingNew")}</>
    ) : (
      <><FeedDot color="var(--meta-ads-success)" glow />{state.count === 1 ? t("node.feedNewPostsOne") : t("node.feedNewPosts", { n: state.count })}</>
    )

  return (
    <div className="relative" style={{ maxWidth: WIDTH }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Rss className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={ICON}
        category="input"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={WIDTH}
        fitContent
        hideHeader
        className={state.kind === "never-ran" ? "border-dashed" : undefined}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={HANDLES}
      >
        <div className="flex flex-col gap-3 px-[18px] pb-4 pt-4">
          <FeedHeaderRow label={t("tgfeed.header")} badge={channelShown} badgeDir="ltr" right={statusRight} />

          {state.kind === "never-ran" && (
            <FeedPlaceholder icon={<Rss />}>{channelShown ? t("node.readsChannel", { channel: channelShown.replace(/^@/, "") }) : t("node.setPublicChannelPlaceholder")}</FeedPlaceholder>
          )}
          {running && <FeedRunningSkeleton />}

          {state.kind === "success" && <PostFeedBody posts={posts} onViewAll={() => setAllOpen(true)} />}

          {state.kind === "empty" && (
            <FeedPlaceholder icon={<Rss />}>{lastSeen !== null ? t("tgfeed.nothingNewSince", { id: lastSeen }) : t("tgfeed.nothingNewYet")}</FeedPlaceholder>
          )}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-red-500">{state.errorMessage || t("node.failed")}</p>
          )}

          {lastSeen !== null && !running && state.kind !== "empty" && (
            <p className="text-[10px] text-[var(--meta-ads-faint)]">{t("node.feedLastSeen", { id: lastSeen })}</p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="telegram-channel-feed" handleId="text" type="source" position={Position.Right} label="Posts" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="telegram-channel-feed" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
      <PostFeedDialog
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={t("tgfeed.allPosts", { channel: channelShown })}
        icon={<Rss />}
        meta={posts.length === 1 ? t("tgfeed.postCountOne") : t("tgfeed.postCount", { n: posts.length })}
        copyValue={nodeData.generatedJson}
        posts={posts}
      />
    </div>
  )
}

export const TelegramChannelFeedNode = memo(TelegramChannelFeedNodeComponent)

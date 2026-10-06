"use client"

import { memo, useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, ChevronLeft, ChevronRight, ExternalLink, Eye, Play, Rss, Type } from "lucide-react"
import type { TelegramChannelPost } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { MetaAdMedia } from "./meta-ad-media"
import { InspectorShell } from "@/components/inspector/inspector-shell"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useTelegramFeedCursor } from "@/hooks/queries/use-telegram-feed-queries"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { getVideoProxyUrl } from "@/lib/api"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { cn } from "@/lib/utils"
import type { TelegramChannelFeedData } from "@/types/nodes"
import {
  deriveTelegramFeedCardState,
  telegramFeedPosts,
  telegramPostDateLabel,
  telegramPostInitial,
  telegramPostPreviewUrl,
  telegramPostVideo,
} from "./telegram-feed-run-state"

const WIDTH = 440
const MAX_THUMBS = 10
const ICON = <Rss className="h-4 w-4" />
const stop = (e: MouseEvent) => e.stopPropagation()

// Two stacked outputs. `text` sits first: an edge with no source handle is
// drawn from the first pip, and both engines read such an edge as the text output.
const HANDLES = [
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
] as const

function Dot({ color, glow }: { readonly color: string; readonly glow?: boolean }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: glow ? "var(--meta-ads-success-glow)" : undefined }} />
}

function HeaderRow({ channel, right }: { readonly channel: string; readonly right: ReactNode }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[var(--meta-ads-info)]">{t("tgfeed.header")}</span>
        {channel && (
          <>
            <span className="text-[11px] text-[var(--meta-ads-faint)]">·</span>
            <span className="truncate rounded-full bg-[var(--meta-ads-info-tint)] px-2 py-[3px] text-[11px] font-bold text-[var(--meta-ads-info)]" dir="ltr">
              {channel}
            </span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[12px] font-semibold text-[var(--meta-ads-muted)]">{right}</div>
    </div>
  )
}

function Placeholder({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-8 text-center">
      <Rss className="h-7 w-7 text-[var(--meta-ads-info)]" />
      <div className="max-w-[320px] text-[12.5px] leading-normal text-[var(--meta-ads-muted)]">{children}</div>
    </div>
  )
}

function RunningSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-[220px] rounded-xl animate-pulse bg-[var(--meta-ads-chip)]" />
      <div className="flex gap-1.5">
        {Array.from({ length: MAX_THUMBS }, (_, i) => (
          <span key={i} className="h-[44px] flex-1 rounded-lg bg-[var(--meta-ads-chip)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function FeaturedVideo({ src, poster }: { readonly src: string; readonly poster: string | null }) {
  return (
    <video
      src={getVideoProxyUrl(src)}
      poster={poster ?? undefined}
      controls
      autoPlay
      playsInline
      preload="metadata"
      className="nodrag nopan absolute inset-0 h-full w-full bg-black object-contain"
      onMouseDown={stop}
      onClick={stop}
    />
  )
}

function OpenPostLink({ post, className }: { readonly post: TelegramChannelPost; readonly className?: string }) {
  const t = useT()
  return (
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      onMouseDown={stop}
      className={cn("flex shrink-0 items-center gap-1 text-[#FF0073] hover:underline", className)}
    >
      {t("tgfeed.openPost")} <ExternalLink className="h-3 w-3" />
    </a>
  )
}

/** Date · forwarded-from, as one muted line. */
function postMetaLine(post: TelegramChannelPost, t: ReturnType<typeof useT>): string {
  return [telegramPostDateLabel(post), post.forwardedFrom ? t("tgfeed.forwardedFrom", { name: post.forwardedFrom.name }) : ""].filter(Boolean).join(" · ")
}

function FeaturedPost({ post }: { readonly post: TelegramChannelPost }) {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const preview = telegramPostPreviewUrl(post)
  const video = telegramPostVideo(post)
  useEffect(() => setPlaying(false), [post])
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
      {(preview || video) && (
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl">
          {playing && video?.url ? (
            <FeaturedVideo src={video.url} poster={preview} />
          ) : (
            <>
              <MetaAdMedia src={preview} initial={telegramPostInitial(post)} className="h-full w-full" />
              {video?.url ? (
                <button
                  type="button"
                  onClick={(e) => { stop(e); setPlaying(true) }}
                  onMouseDown={stop}
                  aria-label={t("cfgext.metaAdsPlayVideo")}
                  className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black"><Play className="h-5 w-5 translate-x-0.5" /></span>
                </button>
              ) : video ? (
                // A "Watch in Telegram" player: the preview page embeds no file.
                <a
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={stop}
                  onMouseDown={stop}
                  className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
                >
                  <span className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-bold text-black">{t("tgfeed.watchInTelegram")}</span>
                </a>
              ) : null}
            </>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-bold text-[var(--meta-ads-text)]">
        <span className="truncate" dir="ltr">@{post.channel} · #{post.id}</span>
        {post.views && (
          <span className="flex shrink-0 items-center gap-1 text-[var(--meta-ads-muted)]">
            <Eye className="h-3.5 w-3.5" />
            {t("tgfeed.views", { views: post.views })}
          </span>
        )}
      </div>
      {post.text && (
        <p dir="auto" className="line-clamp-6 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-[var(--meta-ads-text-2)]">{post.text}</p>
      )}
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
        <span className="truncate">{postMetaLine(post, t)}</span>
        <OpenPostLink post={post} />
      </div>
    </div>
  )
}

function ThumbStrip({ posts, featured, onPick }: {
  readonly posts: ReadonlyArray<TelegramChannelPost>
  readonly featured: number
  readonly onPick: (i: number) => void
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {posts.slice(0, MAX_THUMBS).map((post, i) => (
        <button
          key={post.id}
          type="button"
          onClick={(e) => { stop(e); onPick(i) }}
          onMouseDown={stop}
          className={cn("h-[44px] w-[44px] shrink-0 overflow-hidden rounded-lg transition-all", i === featured ? "ring-2 ring-[#FF0073]" : "opacity-70 hover:opacity-100")}
        >
          <MetaAdMedia src={telegramPostPreviewUrl(post)} initial={telegramPostInitial(post)} className="h-full w-full" initialClassName="text-[13px]" />
        </button>
      ))}
    </div>
  )
}

/** One post in the "all posts" inspector: picture, text, date, views, the link. */
function PostRow({ post }: { readonly post: TelegramChannelPost }) {
  const t = useT()
  return (
    <div className="flex gap-3 rounded-xl border border-border p-3">
      <MetaAdMedia src={telegramPostPreviewUrl(post)} initial={telegramPostInitial(post)} className="h-16 w-16 shrink-0 rounded-lg" initialClassName="text-[15px]" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-muted-foreground">
          <span className="truncate" dir="ltr">#{post.id} · {postMetaLine(post, t)}</span>
          <OpenPostLink post={post} />
        </div>
        {post.text && <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">{post.text}</p>}
        {post.views && <div className="text-[11px] text-muted-foreground">{t("tgfeed.views", { views: post.views })}</div>}
      </div>
    </div>
  )
}

/**
 * Telegram Channel Feed — reads a public channel's new posts. The card is the
 * Instagram / Meta Ads card shape: the newest post featured (picture or
 * video, text, date, views, forwarded-from, a link to the post), arrows and
 * a thumbnail strip over the rest, and "View all" opening every post of the
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
  const posts = telegramFeedPosts(nodeData.generatedJson)
  const newestId = posts[0]?.id
  const [featured, setFeatured] = useState(0)
  const [allOpen, setAllOpen] = useState(false)
  // A new run leads with its newest post again.
  useEffect(() => setFeatured(0), [newestId, posts.length])
  const shownIndex = Math.min(featured, Math.max(0, posts.length - 1))
  const featuredPost = state.kind === "success" ? posts[shownIndex] : undefined
  const step = (delta: number) => {
    if (posts.length === 0) return
    setFeatured((shownIndex + delta + posts.length) % posts.length)
  }

  const channelShown = nodeData.channel ? `@${nodeData.channel.replace(/^@/, "")}` : ""
  const lastSeen = cursor?.lastSeenId ?? null

  const statusRight =
    state.kind === "never-ran" ? (
      <><Dot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><Dot color="var(--meta-ads-info)" />{t("tgfeed.reading")}</>
    ) : state.kind === "failed" ? (
      <><Dot color="#ef4444" /><span className="text-red-500">{t("node.failed")}</span></>
    ) : state.kind === "empty" ? (
      <><Dot color="var(--meta-ads-dot-idle)" />{t("tgfeed.nothingNew")}</>
    ) : (
      <><Dot color="var(--meta-ads-success)" glow />{state.count === 1 ? t("node.feedNewPostsOne") : t("node.feedNewPosts", { n: state.count })}</>
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
          <HeaderRow channel={channelShown} right={statusRight} />

          {state.kind === "never-ran" && (
            <Placeholder>{channelShown ? t("node.readsChannel", { channel: channelShown.replace(/^@/, "") }) : t("node.setPublicChannelPlaceholder")}</Placeholder>
          )}
          {running && <RunningSkeleton />}

          {featuredPost && (
            <div className="flex flex-col gap-3">
              <FeaturedPost post={featuredPost} />
              <div className="flex items-center gap-2">
                {posts.length > 1 && (
                  <>
                    <button type="button" onClick={(e) => { stop(e); step(-1) }} onMouseDown={stop} aria-label={t("cfgext.igPrevPost")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="text-[11.5px] font-semibold tabular-nums text-[var(--meta-ads-muted)]">{shownIndex + 1} / {posts.length}</span>
                    <button type="button" onClick={(e) => { stop(e); step(1) }} onMouseDown={stop} aria-label={t("cfgext.igNextPost")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronRight className="h-4 w-4" /></button>
                  </>
                )}
                <button type="button" onClick={(e) => { stop(e); setAllOpen(true) }} onMouseDown={stop} className="ms-auto text-[11.5px] font-bold text-[#FF0073] hover:underline">{t("node.viewAllN", { n: posts.length })}</button>
              </div>
              {posts.length > 1 && <ThumbStrip posts={posts} featured={shownIndex} onPick={setFeatured} />}
            </div>
          )}

          {state.kind === "empty" && (
            <Placeholder>{lastSeen !== null ? t("tgfeed.nothingNewSince", { id: lastSeen }) : t("tgfeed.nothingNewYet")}</Placeholder>
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
      <InspectorShell
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={t("tgfeed.allPosts", { channel: channelShown })}
        icon={<Rss />}
        meta={posts.length === 1 ? t("tgfeed.postCountOne") : t("tgfeed.postCount", { n: posts.length })}
        copyValue={nodeData.generatedJson}
      >
        {posts.map((post) => <PostRow key={post.id} post={post} />)}
      </InspectorShell>
    </div>
  )
}

export const TelegramChannelFeedNode = memo(TelegramChannelFeedNodeComponent)

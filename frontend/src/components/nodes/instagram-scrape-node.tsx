"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, ChevronLeft, ChevronRight, ExternalLink, Film, Heart, Image as ImageIcon, Instagram, MessageCircle, Play, Search, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useScrapeNodeCredits } from "./use-scrape-node-credits"
import { getVideoProxyUrl } from "@/lib/api"
import { splitInstagramTargets } from "@nodaro/shared"
import type { InstagramScrapeNodeData } from "@/types/nodes"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { cn } from "@/lib/utils"

const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)
import { elapsedLabel, relativeTime } from "./web-scrape-run-state"
import { MetaAdMedia } from "./meta-ad-media"
import {
  clampFeaturedIndex,
  deriveInstagramScrapeCardState,
  instagramCaption,
  instagramInitial,
  instagramLink,
  instagramMediaCounts,
  instagramOwner,
  instagramPreviewUrl,
  instagramScrapeItems,
  instagramStat,
  instagramTimestampLabel,
  instagramVideoUrl,
  instagramVisibleIndexes,
} from "./instagram-scrape-run-state"
import { formatNumber } from "@/lib/i18n/format"

const WIDTH = 440
const MAX_THUMBS = 10
const stop = (e: MouseEvent) => e.stopPropagation()

// One `in` target, four stacked outputs (json / featured text / image / video) —
// same layout + handle ids as the Meta Ads node.
const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: "80px", right: "-29px" }, external: true },
  { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: "108px", right: "-29px" }, external: true },
] as const

function useNowTick(mode: "off" | "slow" | "fast"): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mode === "off") return
    const timer = setInterval(() => setNow(Date.now()), mode === "fast" ? 1_000 : 30_000)
    return () => clearInterval(timer)
  }, [mode])
  return now
}

function Dot({ color, glow }: { readonly color: string; readonly glow?: boolean }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: glow ? "var(--meta-ads-success-glow)" : undefined }} />
}

function HeaderRow({ mode, right }: { readonly mode: "profile" | "hashtag"; readonly right: ReactNode }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[var(--meta-ads-info)]">{t("cfgext.igTitle")}</span>
        <span className="text-[11px] text-[var(--meta-ads-faint)]">·</span>
        <span className="rounded-full bg-[var(--meta-ads-info-tint)] px-2 py-[3px] text-[11px] font-bold uppercase tracking-[.06em] text-[var(--meta-ads-info)]">
          {mode === "hashtag" ? t("cfgext.igModeHashtag") : t("cfgext.igModeProfile")}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--meta-ads-muted)]">{right}</div>
    </div>
  )
}

function TargetField({ data }: { readonly data: InstagramScrapeNodeData }) {
  const t = useT()
  const targets = splitInstagramTargets(data.targets)
  const prefix = data.mode === "hashtag" ? "#" : "@"
  const text = targets.length === 0 ? t("cfgext.igTargetsEmpty") : targets.length === 1 ? `${prefix}${targets[0]}` : `${prefix}${targets[0]} +${targets.length - 1}`
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-2.5 text-[15px] font-semibold text-[var(--meta-ads-text)]">
      <Search className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-faint)]" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function EmptyState({ data }: { readonly data: InstagramScrapeNodeData }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-8 text-center">
      <Instagram className="h-7 w-7 text-[var(--meta-ads-info)]" />
      <div className="text-[15px] font-extrabold text-[var(--meta-ads-text)]">{t("cfgext.igEmptyTitle")}</div>
      <div className="max-w-[320px] text-[12.5px] leading-normal text-[var(--meta-ads-muted)]">
        {data.mode === "hashtag" ? t("cfgext.igEmptyCopyHashtag") : t("cfgext.igEmptyCopyProfile")}
      </div>
    </div>
  )
}

function RunningSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-[300px] rounded-xl animate-pulse bg-[var(--meta-ads-chip)]" />
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

function FeaturedPost({ post }: { readonly post: Record<string, unknown> }) {
  const t = useT()
  const [playing, setPlaying] = useState(false)
  const videoSrc = instagramVideoUrl(post)
  const counts = instagramMediaCounts(post)
  const likes = instagramStat(post, "likesCount")
  const comments = instagramStat(post, "commentsCount")
  const link = instagramLink(post)
  useEffect(() => setPlaying(false), [post])
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl">
        {playing && videoSrc ? (
          <FeaturedVideo src={videoSrc} poster={instagramPreviewUrl(post)} />
        ) : (
          <>
            <MetaAdMedia src={instagramPreviewUrl(post)} initial={instagramInitial(post)} className="h-full w-full" />
            {videoSrc && (
              <button
                type="button"
                onClick={(e) => { stop(e); setPlaying(true) }}
                onMouseDown={stop}
                aria-label={t("cfgext.metaAdsPlayVideo")}
                className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black"><Play className="h-5 w-5 translate-x-0.5" /></span>
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-[12.5px] font-bold text-[var(--meta-ads-text)]">
        <span className="truncate">@{instagramOwner(post) || "?"}</span>
        <span className="flex items-center gap-2.5 text-[var(--meta-ads-muted)]">
          {likes !== null && <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{formatNumber(likes)}</span>}
          {comments !== null && <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{formatNumber(comments)}</span>}
        </span>
      </div>
      {instagramCaption(post) && (
        <p className="line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-[var(--meta-ads-text-2)]">{instagramCaption(post)}</p>
      )}
      <div className="flex items-center justify-between text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
        <span>{[instagramTimestampLabel(post), counts.videos > 0 ? t("cfgext.metaAdsVideoCount", { count: counts.videos }) : t("cfgext.metaAdsImageCount", { count: counts.images })].filter(Boolean).join(" · ")}</span>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#FF0073] hover:underline">
            {t("cfgext.igOpenPost")} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function ThumbStrip({ items, visible, featured, onPick }: {
  readonly items: ReadonlyArray<Record<string, unknown>>
  readonly visible: number[]
  readonly featured: number
  readonly onPick: (i: number) => void
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {visible.slice(0, MAX_THUMBS).map((i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => { stop(e); onPick(i) }}
          onMouseDown={stop}
          className={cn("h-[44px] w-[44px] shrink-0 overflow-hidden rounded-lg transition-all", i === featured ? "ring-2 ring-[#FF0073]" : "opacity-70 hover:opacity-100")}
        >
          <MetaAdMedia src={instagramPreviewUrl(items[i])} initial={instagramInitial(items[i])} className="h-full w-full" initialClassName="text-[13px]" />
        </button>
      ))}
    </div>
  )
}

function InstagramScrapeNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as InstagramScrapeNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)

  const mode = nodeData.mode === "hashtag" ? "hashtag" : "profile"
  const credits = useScrapeNodeCredits(id, "instagram-scrape", nodeData)
  const state = deriveInstagramScrapeCardState(nodeData)
  const running = state.kind === "running"
  const hasAge = state.kind !== "never-ran" && !running && "at" in state && state.at !== undefined
  const now = useNowTick(running ? "fast" : hasAge ? "slow" : "off")

  const items = instagramScrapeItems(nodeData.generatedJson)
  const showResults = state.kind === "success" && items.length > 0
  const visible = instagramVisibleIndexes(items, nodeData.viewFormat)
  const storedFeatured = clampFeaturedIndex(nodeData.featuredIndex, items.length)
  // `featured` is a DISPLAY-only coercion: when a format filter hides the stored
  // post, show the first visible one instead. It must NOT be written back —
  // `featuredIndex` isn't a transient key, so persisting a coercion on mount /
  // filter-change dirties the workflow with no user edit, which surfaces as a
  // spurious autosave and a false "updated on another device". Only an explicit
  // click (`setFeatured`) changes the selection; the output handles read the
  // stored `featuredIndex` clamped to the full list, so this stays wire-neutral.
  const featured = visible.includes(storedFeatured) ? storedFeatured : (visible[0] ?? storedFeatured)
  const featuredPos = Math.max(0, visible.indexOf(featured))
  const featuredPost = showResults ? items[featured] : undefined
  const setFeatured = (index: number) => updateNodeData(id, { featuredIndex: (index + items.length) % items.length })
  const stepFeatured = (delta: number) => {
    if (visible.length === 0) return
    setFeatured(visible[(featuredPos + delta + visible.length) % visible.length])
  }

  const statusRight =
    state.kind === "never-ran" ? (
      <><Dot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><Dot color="var(--meta-ads-info)" />{t("node.scraping")}<span className="tabular-nums text-[var(--meta-ads-muted)]/80">{elapsedLabel(state.startedAt, now)}</span></>
    ) : state.kind === "failed" ? (
      <><Dot color="#ef4444" /><span className="text-red-500">{t("node.failed")}</span><span className="tabular-nums">{relativeTime(state.at, now)}</span></>
    ) : (
      <>
        <Dot color={state.count > 0 ? "var(--meta-ads-success)" : "var(--meta-ads-dot-idle)"} glow={state.count > 0} />
        {t("cfgext.igCountResults", { count: state.count })}
        <span className="text-[var(--meta-ads-faint)]">·</span>
        <span className="tabular-nums">{relativeTime(state.at, now)}</span>
      </>
    )

  return (
    <div className="relative" style={{ maxWidth: WIDTH }}>
      <EditableNodeLabel label={nodeData.label} icon={<Instagram className="h-4 w-4" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Instagram className="h-4 w-4" />}
        category="input"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={WIDTH}
        hideHeader
        className={state.kind === "never-ran" ? "border-dashed" : undefined}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={HANDLES}
      >
        <div className="flex flex-col gap-3 px-[18px] pb-4 pt-4">
          <HeaderRow mode={mode} right={statusRight} />
          <TargetField data={nodeData} />

          {state.kind !== "never-ran" && state.kind !== "running" && "stale" in state && state.stale && (
            <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">{t("node.inputsChangedStale")}</div>
          )}

          {state.kind === "never-ran" && <EmptyState data={nodeData} />}
          {running && <RunningSkeleton />}

          {showResults && featuredPost && (
            <div className={cn("flex flex-col gap-3", state.kind === "success" && state.stale ? "opacity-60" : "")}>
              <FeaturedPost post={featuredPost} />
              {visible.length > 1 && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={(e) => { stop(e); stepFeatured(-1) }} onMouseDown={stop} aria-label={t("cfgext.metaAdsPrevAd")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-[11.5px] font-semibold tabular-nums text-[var(--meta-ads-muted)]">{featuredPos + 1} / {visible.length}</span>
                  <button type="button" onClick={(e) => { stop(e); stepFeatured(1) }} onMouseDown={stop} aria-label={t("cfgext.metaAdsNextAd")} className="rounded-full border border-[var(--meta-ads-border)] p-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"><ChevronRight className="h-4 w-4" /></button>
                  <button type="button" onClick={(e) => { stop(e); selectNode?.(id) }} onMouseDown={stop} className="ms-auto text-[11.5px] font-bold text-[#FF0073] hover:underline">{t("node.viewAllN", { n: items.length })}</button>
                </div>
              )}
              {visible.length > 1 && <ThumbStrip items={items} visible={visible} featured={featured} onPick={setFeatured} />}
            </div>
          )}

          {state.kind === "empty" && (
            <div className="rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-8 text-center text-[12.5px] text-[var(--meta-ads-muted)]">{t("node.queryMatchedNothing")}</div>
          )}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-[var(--meta-ads-muted)]">{nodeData.errorMessage || t("node.scrapeFailed")}</p>
          )}
        </div>
      </BaseNode>
      {/* The real handle pips (colours / icons / labels). Kept in lockstep with HANDLES above and HANDLE_OUTPUT_TYPES. */}
      <HandleWithPopover nodeId={id} nodeType="instagram-scrape" handleId="in" type="target" position={Position.Left} label={t("cfgext.metaAdsInHandle")} color={DATA_HANDLE_COLORS.text} icon={<Search />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="instagram-scrape" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="instagram-scrape" handleId="text" type="source" position={Position.Right} label={t("cfgext.metaAdsOutText")} color={DATA_HANDLE_COLORS.text} icon={<Type />} side="right" top="52px" />
      <HandleWithPopover nodeId={id} nodeType="instagram-scrape" handleId="image" type="source" position={Position.Right} label={t("cfgext.metaAdsOutImage")} color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="80px" />
      <HandleWithPopover nodeId={id} nodeType="instagram-scrape" handleId="video" type="source" position={Position.Right} label={t("cfgext.metaAdsOutVideo")} color={HANDLE_COLORS.video} icon={<Film />} side="right" top="108px" />
    </div>
  )
}

export const InstagramScrapeNode = memo(InstagramScrapeNodeComponent)

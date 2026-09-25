"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, ChevronLeft, ChevronRight, ExternalLink, Film, Image as ImageIcon, Play, Search, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useScrapeNodeCredits } from "./use-scrape-node-credits"
import { getVideoProxyUrl } from "@/lib/api"
import { META_ADS_PLATFORMS, META_ADS_SCRAPE_DEFAULT_COUNT, metaAdsAdvertisersFrom, metaAdsNodeMode, splitMetaAdsPageUrls, type MetaAdsNodeMode } from "@nodaro/shared"
import type { MetaAdsScrapeNodeData } from "@/types/nodes"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { cn } from "@/lib/utils"
import { elapsedLabel, relativeTime } from "./web-scrape-run-state"
import { MetaMark } from "./meta-ads-mark"
import { MetaAdMedia, META_AD_STRIPES } from "./meta-ad-media"
import {
  clampFeaturedIndex,
  deriveMetaAdsScrapeCardState,
  metaAdDateRange,
  metaAdDomain,
  metaAdFormat,
  metaAdHeadline,
  metaAdInitial,
  metaAdLink,
  metaAdMediaCounts,
  metaAdPlatformLabel,
  metaAdPlatforms,
  metaAdPreviewUrl,
  metaAdRunDays,
  metaAdVideoUrl,
  metaAdsActiveCount,
  metaAdsFormatLabelKey,
  metaAdsScrapeItems,
  metaAdsVisibleIndexes,
} from "./meta-ads-scrape-run-state"

// Same `in` semantics as Web Scrape: a keyword or a page list arrives as text.
const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)

// Four stacked outputs on the right (28px step, like video-analysis): the
// whole ad array as JSON, then the FEATURED ad's copy, image and video.
// Keep this array and the HandleWithPopover set below in lockstep.
const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: "80px", right: "-29px" }, external: true },
  { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: "108px", right: "-29px" }, external: true },
] as const

/** Design handoff: 480 before the first run, 680 once there is a featured ad to show. */
const WIDTH_IDLE = 480
const WIDTH_RESULTS = 680
const MAX_THUMBS = 12
/** Platform chips the empty state previews before the rest collapse into "+N". */
const EMPTY_STATE_CHIPS = 3

/** Every clickable inside the card: no canvas drag/pan, no node select. */
const stop = (e: MouseEvent) => e.stopPropagation()

function useNowTick(mode: "off" | "slow" | "fast"): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mode === "off") return
    const timer = setInterval(() => setNow(Date.now()), mode === "fast" ? 1_000 : 30_000)
    return () => clearInterval(timer)
  }, [mode])
  return now
}

function Chip({ children }: { readonly children: ReactNode }) {
  return (
    <span className="rounded-md bg-[var(--meta-ads-chip)] px-[7px] py-[3px] text-[10.5px] font-bold tracking-[.04em] text-[var(--meta-ads-text-2)]">
      {children}
    </span>
  )
}

function Dot({ color, glow }: { readonly color: string; readonly glow?: boolean }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: glow ? "var(--meta-ads-success-glow)" : undefined }} />
}

/** `META ADS · KEYWORD` on the left, run status on the right. */
function HeaderRow({ mode, right }: { readonly mode: MetaAdsNodeMode; readonly right: ReactNode }) {
  const t = useT()
  const modeLabel: Record<MetaAdsNodeMode, string> = {
    search: t("cfgext.metaAdsModeSearch"),
    pages: t("cfgext.metaAdsModePages"),
    advertiser: t("cfgext.metaAdsModeAdvertiser"),
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[var(--meta-ads-info)]">{t("cfgext.metaAdsTitle")}</span>
        <span className="text-[11px] text-[var(--meta-ads-faint)]">·</span>
        <span className="rounded-full bg-[var(--meta-ads-info-tint)] px-2 py-[3px] text-[11px] font-bold uppercase tracking-[.06em] text-[var(--meta-ads-info)]">
          {modeLabel[mode]}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--meta-ads-muted)]">{right}</div>
    </div>
  )
}

/** The keyword / page list / advertiser picks the run used, in the design's search field. */
function QueryField({ data }: { readonly data: MetaAdsScrapeNodeData }) {
  const t = useT()
  const mode = metaAdsNodeMode(data.mode)
  let text: string
  if (mode === "advertiser") {
    const names = metaAdsAdvertisersFrom(data.advertisers).map((a) => a.name)
    text = names.length === 0 ? t("cfgext.metaAdsAdvertisersEmpty") : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  } else if (mode === "pages") {
    const urls = splitMetaAdsPageUrls(data.pageUrls)
    text = urls.length === 0 ? t("cfgext.metaAdsPageUrlsEmpty") : urls.length === 1 ? urls[0] : `${urls[0]} +${urls.length - 1}`
  } else {
    text = data.query?.trim() || t("cfgext.metaAdsQueryEmpty")
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-2.5 text-[15px] font-semibold text-[var(--meta-ads-text)]">
      <Search className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-faint)]" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function EmptyState({ data }: { readonly data: MetaAdsScrapeNodeData }) {
  const t = useT()
  const card = (extra: string) => (
    <div className={cn("h-[72px] w-[54px] rounded-[10px]", extra)} style={META_AD_STRIPES} />
  )
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-9 text-center">
      <div className="flex gap-2">
        {card("opacity-50 -rotate-[8deg] translate-y-1.5")}
        {card("border border-[var(--meta-ads-accent-border)]")}
        {card("opacity-50 rotate-[8deg] translate-y-1.5")}
      </div>
      <div className="text-[15px] font-extrabold text-[var(--meta-ads-text)]">{t("cfgext.metaAdsEmptyTitle")}</div>
      <div className="max-w-[340px] text-[12.5px] leading-normal text-[var(--meta-ads-muted)]">
        {metaAdsNodeMode(data.mode) === "advertiser"
          ? t("cfgext.metaAdsEmptyCopyAdvertiser")
          : metaAdsNodeMode(data.mode) === "pages"
            ? t("cfgext.metaAdsEmptyCopyPages")
            : t("cfgext.metaAdsEmptyCopySearch")}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {META_ADS_PLATFORMS.slice(0, EMPTY_STATE_CHIPS).map((code) => (
          <Chip key={code}>{metaAdPlatformLabel(code)}</Chip>
        ))}
        <Chip>+{META_ADS_PLATFORMS.length - EMPTY_STATE_CHIPS}</Chip>
      </div>
    </div>
  )
}

/** Skeleton of the featured card + shimmering thumbs while the actor runs. */
function RunningSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-[18px] rounded-2xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
        <div className="h-[400px] rounded-xl animate-pulse" style={META_AD_STRIPES} />
        <div className="flex flex-col gap-3 pt-1">
          <span className="h-4 w-1/2 rounded bg-[var(--meta-ads-chip)] animate-pulse" />
          <span className="h-5 w-11/12 rounded bg-[var(--meta-ads-chip)] animate-pulse" />
          <span className="h-3 w-full rounded bg-[var(--meta-ads-chip)] animate-pulse" />
          <span className="h-3 w-10/12 rounded bg-[var(--meta-ads-chip)] animate-pulse" />
          <span className="h-3 w-9/12 rounded bg-[var(--meta-ads-chip)] animate-pulse" />
        </div>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: MAX_THUMBS }, (_, i) => (
          <span key={i} className="h-[52px] flex-1 rounded-lg bg-[var(--meta-ads-chip)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

/** Inline player for the featured creative — mounts only after the play pill is pressed, keyed per ad. */
function FeaturedVideo({ src, poster, onUnavailable }: { readonly src: string; readonly poster: string | null; readonly onUnavailable: () => void }) {
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
      onError={onUnavailable}
    />
  )
}

function FeaturedAd({ ad }: { readonly ad: Record<string, unknown> }) {
  const t = useT()
  const counts = metaAdMediaCounts(ad)
  const adKey = typeof ad.adArchiveId === "string" ? ad.adArchiveId : ""
  // Play state is per featured ad: switching ads returns to the poster.
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const [unavailableKey, setUnavailableKey] = useState<string | null>(null)
  const videoSrc = metaAdVideoUrl(ad)
  const playing = videoSrc !== null && playingKey === adKey
  const unavailable = unavailableKey === adKey
  const mediaLabel =
    counts.videos > 0
      ? counts.videos === 1 ? t("cfgext.metaAdsVideoOne") : t("cfgext.metaAdsVideoCount", { count: counts.videos })
      : counts.images === 1 ? t("cfgext.metaAdsImageOne") : t("cfgext.metaAdsImageCount", { count: counts.images })
  const platforms = metaAdPlatforms(ad)
  const formatKey = metaAdsFormatLabelKey(metaAdFormat(ad))
  const days = metaAdRunDays(ad)
  const link = metaAdLink(ad)
  const domain = metaAdDomain(ad)
  const cta = typeof ad.ctaText === "string" && ad.ctaText.trim() ? ad.ctaText.trim() : t("cfgext.metaAdsNoCta")
  const active = ad.isActive === true
  const body = typeof ad.text === "string" ? ad.text : ""

  return (
    <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-[18px] rounded-2xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
      <MetaAdMedia src={metaAdPreviewUrl(ad)} initial={metaAdInitial(ad)} className="h-[400px] rounded-xl" initialClassName="text-[40px]">
        {playing && videoSrc && (
          <FeaturedVideo src={videoSrc} poster={metaAdPreviewUrl(ad)} onUnavailable={() => { setUnavailableKey(adKey); setPlayingKey(null) }} />
        )}
        {videoSrc && !playing && !unavailable && (
          // The whole poster is the play target; the pill doubles as its label.
          <button
            type="button"
            aria-label={t("cfgext.metaAdsPlayVideo")}
            className="nodrag nopan absolute inset-0 grid place-items-center bg-transparent"
            onMouseDown={stop}
            onClick={(e) => {
              stop(e)
              setPlayingKey(adKey)
            }}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur-[8px] transition-transform hover:scale-105">
              <Play className="ms-0.5 h-6 w-6 fill-current" />
            </span>
          </button>
        )}
        {unavailable && (
          <span className="absolute inset-x-2.5 bottom-2.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white backdrop-blur-[8px]">
            {t("cfgext.metaAdsVideoUnavailable")}
          </span>
        )}
        {(counts.videos > 0 || counts.images > 0) && !playing && (
          <span className="pointer-events-none absolute start-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-[8px]">
            {counts.videos > 0 ? <Play className="h-2.5 w-2.5 fill-current" /> : null}
            {mediaLabel}
          </span>
        )}
        {link && !playing && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            title={t("cfgext.metaAdsOpenAdLibrary")}
            className="nodrag nopan absolute end-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-[8px] hover:bg-black/70"
            onMouseDown={stop}
            onClick={stop}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </MetaAdMedia>

      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#FF0073] to-[#7b3dff] text-[13px] font-extrabold text-white">
              {metaAdInitial(ad)}
            </span>
            <span className="truncate text-[15px] font-extrabold text-[var(--meta-ads-text)]">{typeof ad.pageName === "string" ? ad.pageName : ""}</span>
          </div>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-extrabold",
              active ? "bg-[var(--meta-ads-success-tint)] text-[var(--meta-ads-success-text)]" : "bg-[var(--meta-ads-chip)] text-[var(--meta-ads-muted)]",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "var(--meta-ads-success)" : "var(--meta-ads-faint)" }} />
            {active ? t("cfgext.metaAdsStatusActive") : t("cfgext.metaAdsStatusInactive")}
          </span>
        </div>

        <div className="line-clamp-2 text-[15.5px] font-bold leading-[1.35] text-[var(--meta-ads-text)]">{metaAdHeadline(ad)}</div>
        <div className="line-clamp-5 whitespace-pre-line text-[13px] leading-[1.55] text-[var(--meta-ads-muted)]">{body}</div>

        <div className="mt-auto flex flex-col gap-2">
          {(platforms.length > 0 || formatKey) && (
            <div className="flex flex-wrap gap-1.5">
              {formatKey && (
                <span className="rounded-md bg-[var(--meta-ads-info-tint)] px-[7px] py-[3px] text-[10.5px] font-bold tracking-[.04em] text-[var(--meta-ads-info)]">
                  {t(formatKey)}
                </span>
              )}
              {platforms.map((p) => (
                <Chip key={p}>{metaAdPlatformLabel(p)}</Chip>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
            <span>{metaAdDateRange(ad)}</span>
            {days !== null && <span>{t("cfgext.metaAdsRunDays", { count: days })}</span>}
          </div>
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-2.5 py-2">
            <span className="flex-1 truncate text-[11.5px] text-[var(--meta-ads-muted)]">{domain}</span>
            <span className="shrink-0 rounded-[7px] bg-[var(--meta-ads-cta-bg)] px-2.5 py-[5px] text-[11.5px] font-extrabold text-[var(--meta-ads-cta-fg)]">{cta}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThumbStrip({
  items,
  visible,
  featured,
  onPick,
}: {
  readonly items: ReadonlyArray<Record<string, unknown>>
  /** Indexes into `items` the view filter shows, in order. */
  readonly visible: readonly number[]
  readonly featured: number
  readonly onPick: (index: number) => void
}) {
  return (
    <div className="flex gap-1.5 overflow-hidden">
      {visible.slice(0, MAX_THUMBS).map((i) => {
        const ad = items[i]
        return (
          <button
            key={typeof ad.adArchiveId === "string" ? ad.adArchiveId : i}
            type="button"
            className={cn(
              "nodrag nopan relative h-[52px] min-w-0 flex-1 overflow-hidden rounded-lg transition-opacity",
              i === featured ? "opacity-100 ring-2 ring-inset ring-[#FF0073]" : "opacity-[var(--meta-ads-thumb-dim)] hover:opacity-90",
            )}
            onMouseDown={stop}
            onClick={(e) => {
              stop(e)
              onPick(i)
            }}
          >
            <MetaAdMedia src={metaAdPreviewUrl(ad)} initial={metaAdInitial(ad)} className="h-full w-full" initialClassName="text-[13px]" />
          </button>
        )
      })}
    </div>
  )
}

function MetaAdsScrapeNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as MetaAdsScrapeNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)

  const mode = metaAdsNodeMode(nodeData.mode)
  const credits = useScrapeNodeCredits(id, "meta-ads-scrape", nodeData)
  const state = deriveMetaAdsScrapeCardState(nodeData)
  const running = state.kind === "running"
  const hasAge = state.kind !== "never-ran" && !running && "at" in state && state.at !== undefined
  const now = useNowTick(running ? "fast" : hasAge ? "slow" : "off")

  const items = metaAdsScrapeItems(nodeData.generatedJson)
  const showResults = state.kind === "success" && items.length > 0
  // The Results tab's format chips narrow what the strip and pager walk; the
  // featured index still addresses the FULL array (it feeds the outputs), so
  // a featured ad outside the current view falls back to the first visible.
  const visible = metaAdsVisibleIndexes(items, nodeData.viewFormat)
  const storedFeatured = clampFeaturedIndex(nodeData.featuredIndex, items.length)
  const featured = visible.includes(storedFeatured) ? storedFeatured : (visible[0] ?? storedFeatured)
  const featuredPos = Math.max(0, visible.indexOf(featured))
  // `featured` is DISPLAY-only: when a format filter hides the stored ad, show
  // the first visible one. Do NOT persist that coercion — `featuredIndex` isn't
  // a transient key, so writing it on mount / filter-change dirties the workflow
  // with no user edit and surfaces as a spurious autosave + a false "updated on
  // another device". Only an explicit click (`setFeatured`) changes the
  // selection; the outputs read the stored `featuredIndex` clamped to the full
  // list, so filtering the view never changes what the wires emit.

  // The card has two very different boxes (480px empty state, 680px featured
  // ad). A node keeps whatever width/height React Flow last stored for it, so
  // the first run — or a workflow saved with the old card — would render the
  // new layout inside the old box and clip it. Clear the stored box on every
  // layout switch (and on mount) so the content sizes the node again; a box
  // the user resized by hand (`rf-resized`) is left alone. Same mechanism
  // BaseNode uses on its inline-editor toggle.
  const layoutKey = showResults ? "results" : "idle"
  const prevLayoutRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (prevLayoutRef.current === layoutKey) return
    prevLayoutRef.current = layoutKey
    useWorkflowStore.setState((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n
        const resized = typeof n.className === "string" && n.className.includes("rf-resized")
        return resized ? n : { ...n, width: undefined, height: undefined }
      }),
    }))
  }, [layoutKey, id])
  const featuredAd = showResults ? items[featured] : undefined
  const setFeatured = (index: number) => updateNodeData(id, { featuredIndex: (index + items.length) % items.length })
  /** ‹ › walk the VISIBLE ads (wrapping), not the raw array. */
  const stepFeatured = (delta: number) => {
    if (visible.length === 0) return
    const next = visible[(featuredPos + delta + visible.length) % visible.length]
    setFeatured(next)
  }
  const count = nodeData.count ?? META_ADS_SCRAPE_DEFAULT_COUNT
  const status = nodeData.activeStatus ?? "active"

  const statusRight =
    state.kind === "never-ran" ? (
      <>
        <Dot color="var(--meta-ads-dot-idle)" />
        {t("node.notRunYet")}
      </>
    ) : running ? (
      <>
        <Dot color="var(--meta-ads-info)" />
        {t("node.scraping")}
        <span className="tabular-nums text-[var(--meta-ads-muted)]/80">{elapsedLabel(state.startedAt, now)}</span>
      </>
    ) : state.kind === "failed" ? (
      <>
        <Dot color="#ef4444" />
        <span className="text-red-500">{t("node.failed")}</span>
        <span className="tabular-nums">{relativeTime(state.at, now)}</span>
      </>
    ) : (
      <>
        <Dot color={state.count > 0 ? "var(--meta-ads-success)" : "var(--meta-ads-dot-idle)"} glow={state.count > 0} />
        {t("cfgext.metaAdsCountResults", { count: state.count })}
        {state.count > 0 && (
          <>
            <span className="text-[var(--meta-ads-faint)]">·</span>
            {t("cfgext.metaAdsCountActive", { count: metaAdsActiveCount(items) })}
          </>
        )}
        <span className="text-[var(--meta-ads-faint)]">·</span>
        <span className="tabular-nums">{relativeTime(state.at, now)}</span>
      </>
    )

  return (
    <div className="relative" style={{ maxWidth: showResults ? WIDTH_RESULTS : WIDTH_IDLE }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<MetaMark width={22} height={14} />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<MetaMark width={20} height={12} />}
        category="input"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={showResults ? WIDTH_RESULTS : WIDTH_IDLE}
        hideHeader
        className={state.kind === "never-ran" ? "border-dashed" : undefined}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={HANDLES}
      >
        <div className="flex flex-col gap-3 px-[18px] pb-4 pt-4">
          <HeaderRow mode={mode} right={statusRight} />
          <QueryField data={nodeData} />

          {state.kind !== "never-ran" && state.kind !== "running" && state.stale && (
            <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              {t("node.inputsChangedStale")}
            </div>
          )}

          {state.kind === "never-ran" && <EmptyState data={nodeData} />}
          {running && <RunningSkeleton />}

          {showResults && featuredAd && (
            <div className={cn("flex flex-col gap-3", state.kind === "success" && state.stale ? "opacity-60" : "")}>
              <FeaturedAd ad={featuredAd} />
              {visible.length > 1 && <ThumbStrip items={items} visible={visible} featured={featured} onPick={setFeatured} />}
            </div>
          )}

          {state.kind === "empty" && (
            <div className="rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-8 text-center text-[12.5px] text-[var(--meta-ads-muted)]">
              {t("node.queryMatchedNothing")}
            </div>
          )}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-[var(--meta-ads-muted)]">
              {nodeData.errorMessage || t("node.scrapeFailed")}
              {state.kept && (
                <>
                  {t("common.fragmentGap")}
                  <span className="font-semibold text-[var(--meta-ads-text-2)]">
                    {t(state.kept.count === 1 ? "node.previousResultKeptOne" : "node.previousResultKeptOther", {
                      n: state.kept.count,
                      when: state.kept.at ? `${t("common.listComma")}${relativeTime(state.kept.at, now)}` : "",
                    })}
                  </span>
                </>
              )}
            </p>
          )}

          {/* Footer: pager + links after a run; the run's ceiling before one. */}
          <div className="flex items-center justify-between gap-2">
            {showResults ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t("cfgext.metaAdsPrevAd")}
                  className="nodrag nopan grid h-7 w-7 place-items-center rounded-lg border border-[var(--meta-ads-border)] text-[var(--meta-ads-text-2)] hover:bg-[var(--meta-ads-chip)]"
                  onMouseDown={stop}
                  onClick={(e) => {
                    stop(e)
                    stepFeatured(-1)
                  }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[52px] text-center text-[12px] font-bold tabular-nums text-[var(--meta-ads-text-2)]">
                  {featuredPos + 1} / {visible.length}
                </span>
                <button
                  type="button"
                  aria-label={t("cfgext.metaAdsNextAd")}
                  className="nodrag nopan grid h-7 w-7 place-items-center rounded-lg border border-[var(--meta-ads-border)] text-[var(--meta-ads-text-2)] hover:bg-[var(--meta-ads-chip)]"
                  onMouseDown={stop}
                  onClick={(e) => {
                    stop(e)
                    stepFeatured(1)
                  }}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-[12px] font-semibold text-[var(--meta-ads-muted)]">
                {t(
                  status === "active" ? "cfgext.metaAdsUpToActive" : status === "inactive" ? "cfgext.metaAdsUpToInactive" : "cfgext.metaAdsUpToAll",
                  { count },
                )}
              </span>
            )}
            {showResults && (
              <div className="flex items-center gap-3.5 text-[12px] font-bold">
                {featuredAd && metaAdLink(featuredAd) && (
                  <a
                    href={metaAdLink(featuredAd) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nodrag nopan flex items-center gap-1 text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]"
                    onMouseDown={stop}
                    onClick={stop}
                  >
                    {t("cfgext.metaAdsAdLibrary")} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  type="button"
                  className="nodrag nopan text-[#FF0073] hover:underline"
                  onMouseDown={stop}
                  onClick={(e) => {
                    stop(e)
                    selectNode?.(id)
                  }}
                >
                  {t("node.viewAllN", { n: items.length })}
                </button>
              </div>
            )}
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="meta-ads-scrape" handleId="in" type="target" position={Position.Left} label={t("cfgext.metaAdsInHandle")} color={DATA_HANDLE_COLORS.text} icon={<Search />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="meta-ads-scrape" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="meta-ads-scrape" handleId="text" type="source" position={Position.Right} label={t("cfgext.metaAdsOutText")} color={DATA_HANDLE_COLORS.text} icon={<Type />} side="right" top="52px" />
      <HandleWithPopover nodeId={id} nodeType="meta-ads-scrape" handleId="image" type="source" position={Position.Right} label={t("cfgext.metaAdsOutImage")} color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="80px" />
      <HandleWithPopover nodeId={id} nodeType="meta-ads-scrape" handleId="video" type="source" position={Position.Right} label={t("cfgext.metaAdsOutVideo")} color={HANDLE_COLORS.video} icon={<Film />} side="right" top="108px" />
    </div>
  )
}

export const MetaAdsScrapeNode = memo(MetaAdsScrapeNodeComponent)

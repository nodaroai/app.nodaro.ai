"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Lock, ScanSearch, Search, Type } from "lucide-react"
import { socialSearchMode, socialSearchPlatform } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { MetaAdMedia } from "./meta-ad-media"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useScrapeNodeCredits } from "./use-scrape-node-credits"
import type { SocialSearchNodeData } from "@/types/nodes"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { cn } from "@/lib/utils"
import { elapsedLabel, relativeTime } from "./web-scrape-run-state"
import { deriveSocialSearchCardState, socialSearchChosen, socialSearchResults } from "./social-search-run-state"
import { SOCIAL_PLATFORM_META, choiceLine, socialModeLabel } from "@/components/research/social-platforms"
import { SocialPostPicker } from "@/components/research/social-post-picker"

const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)
const WIDTH = 400
const MAX_THUMBS = 6
const stop = (e: MouseEvent) => e.stopPropagation()

// One `in` target (a keyword or an account from a Text or List node), two
// outputs: the chosen posts as JSON and as a digest.
const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
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

function Panel({ children, dashed }: { readonly children: ReactNode; readonly dashed?: boolean }) {
  return (
    <div className={cn("rounded-2xl px-5 py-6 text-center text-[12.5px] text-[var(--meta-ads-muted)]", dashed ? "border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)]" : "")}>
      {children}
    </div>
  )
}

function SocialSearchNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SocialSearchNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const [pickerOpen, setPickerOpen] = useState(false)

  const platform = socialSearchPlatform(nodeData.platform)
  const mode = socialSearchMode(platform, nodeData.mode)
  const meta = SOCIAL_PLATFORM_META[platform]
  const credits = useScrapeNodeCredits(id, "social-search", nodeData)
  const state = deriveSocialSearchCardState(nodeData)
  const running = state.kind === "running"
  const hasAge = state.kind !== "never-ran" && !running && "at" in state && state.at !== undefined
  const now = useNowTick(running ? "fast" : hasAge ? "slow" : "off")

  const results = socialSearchResults(nodeData)
  const chosen = socialSearchChosen(nodeData)
  const picked = Array.isArray(nodeData.pickedIds) && nodeData.pickedIds.length > 0
  const query = (nodeData.query ?? "").trim()
  const warnings = Array.isArray(nodeData.searchWarnings) ? nodeData.searchWarnings : []

  const statusRight =
    state.kind === "never-ran" ? (
      <><Dot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><Dot color="var(--meta-ads-info)" />{t("social.searching")}<span className="tabular-nums text-[var(--meta-ads-muted)]/80">{elapsedLabel(state.startedAt, now)}</span></>
    ) : state.kind === "failed" ? (
      <><Dot color="#ef4444" /><span className="text-red-500">{t("node.failed")}</span><span className="tabular-nums">{relativeTime(state.at, now)}</span></>
    ) : (
      <>
        <Dot color={state.count > 0 ? "var(--meta-ads-success)" : "var(--meta-ads-dot-idle)"} glow={state.count > 0} />
        {state.count === 1 ? t("social.countResultsOne") : t("social.countResults", { count: state.count })}
        <span className="text-[var(--meta-ads-faint)]">·</span>
        <span className="tabular-nums">{relativeTime(state.at, now)}</span>
      </>
    )

  return (
    <div className="relative" style={{ maxWidth: WIDTH }}>
      <EditableNodeLabel label={nodeData.label} icon={<ScanSearch className="h-4 w-4" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ScanSearch className="h-4 w-4" />}
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[var(--meta-ads-info)]">
              {meta.icon("h-3.5 w-3.5")}
              <span className="text-[11px] font-extrabold uppercase tracking-[.14em]">{meta.name}</span>
              <span className="rounded-full bg-[var(--meta-ads-info-tint)] px-2 py-[3px] text-[11px] font-bold uppercase tracking-[.06em]">{t(socialModeLabel(platform, mode))}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--meta-ads-muted)]">{statusRight}</div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-2.5 text-[15px] font-semibold text-[var(--meta-ads-text)]">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-faint)]" />
            <span className="truncate" dir="auto">{query || t("social.queryEmpty")}</span>
          </div>

          {state.kind !== "never-ran" && state.kind !== "running" && "stale" in state && state.stale && (
            <div className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">{t("node.inputsChangedStale")}</div>
          )}

          {state.kind === "never-ran" && (
            <Panel dashed>
              <div className="mb-1 text-[15px] font-extrabold text-[var(--meta-ads-text)]">{t("social.emptyTitle")}</div>
              {t("social.emptyCopy")}
            </Panel>
          )}

          {running && (
            <div className="grid grid-cols-3 gap-1.5" aria-hidden>
              {Array.from({ length: MAX_THUMBS }, (_, i) => <span key={i} className="aspect-[3/4] rounded-lg bg-[var(--meta-ads-chip)] animate-pulse" />)}
            </div>
          )}

          {!running && results.length > 0 && chosen.length > 0 && (
            <div className={cn("flex flex-col gap-2.5", state.kind === "success" && state.stale ? "opacity-60" : "")}>
              <div className="grid grid-cols-3 gap-1.5">
                {chosen.slice(0, MAX_THUMBS).map((post) => (
                  <MetaAdMedia
                    key={post.id}
                    src={post.media.thumbnailUrl ?? post.author.avatarUrl ?? null}
                    initial={(post.author.handle || post.author.name || "?").charAt(0).toUpperCase()}
                    className="aspect-[3/4] w-full rounded-lg"
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
                <span>{choiceLine(picked, chosen.length, t)}</span>
                {nodeData.keepPicks === true && (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--meta-ads-accent-tint)] px-2 py-0.5 text-[10.5px] font-bold text-[#FF0073]">
                    <Lock className="h-3 w-3" />{t("social.keptBadge")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { stop(e); setPickerOpen(true) }}
                  onMouseDown={stop}
                  className="nodrag ms-auto rounded-full bg-[#FF0073] px-3 py-1 text-[11.5px] font-bold text-white hover:bg-[#e00066]"
                >
                  {t("social.pickPosts")}
                </button>
              </div>
            </div>
          )}

          {state.kind === "empty" && <Panel dashed>{t("node.queryMatchedNothing")}</Panel>}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-[var(--meta-ads-muted)]">{nodeData.errorMessage || t("node.scrapeFailed")}</p>
          )}

          {!running && warnings.length > 0 && (
            <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">{warnings[0]}</p>
          )}
        </div>
      </BaseNode>
      {/* The real handle pips (colours / icons / labels). Kept in lockstep with HANDLES above and HANDLE_OUTPUT_TYPES. */}
      <HandleWithPopover nodeId={id} nodeType="social-search" handleId="in" type="target" position={Position.Left} label={t("social.inHandle")} color={DATA_HANDLE_COLORS.text} icon={<Search />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="social-search" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="social-search" handleId="text" type="source" position={Position.Right} label={t("social.outText")} color={DATA_HANDLE_COLORS.text} icon={<Type />} side="right" top="52px" />
      <SocialPostPicker data={nodeData} open={pickerOpen} onOpenChange={setPickerOpen} onApply={(patch) => updateNodeData(id, patch)} />
    </div>
  )
}

export const SocialSearchNode = memo(SocialSearchNodeComponent)

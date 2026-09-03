"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Globe, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { estimateNodeCredits } from "@/components/editor/workflow-editor/types"
import { SCRAPER_ACTOR_LABELS, type ScraperActorId } from "@nodaro/shared"
import type { WebScrapeNodeData } from "@/types/nodes"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import {
  WEB_SCRAPE_PEEK,
  webScrapeItemLink,
  deriveWebScrapeCardState,
  elapsedLabel,
  relativeTime,
  webScrapeItems,
  webScrapePeekLine,
} from "./web-scrape-run-state"

const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true },
] as const

function getActorSummary(nodeData: WebScrapeNodeData): string {
  switch (nodeData.actor) {
    case "content-crawler":
      return nodeData.url?.trim() || "Enter website URL..."
    case "instagram":
    case "tiktok":
      return nodeData.target?.trim() || "Enter target..."
    // rss reads url like content-crawler — it fell through to the query
    // default and showed "Enter search query..." on a configured feed.
    case "rss":
      return nodeData.url?.trim() || "Enter feed URL..."
    case "google-search":
    default:
      return nodeData.query?.trim() || "Enter search query..."
  }
}

/**
 * Live clock for the status row. 1s cadence ONLY while running (the elapsed
 * counter needs it); 30s otherwise — "2m ago" doesn't, and a canvas full of
 * completed scrape nodes must not each re-render every second forever
 * (#765 review finding). Off entirely when there is nothing to age.
 */
function useNowTick(mode: "off" | "slow" | "fast"): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mode === "off") return
    const t = setInterval(() => setNow(Date.now()), mode === "fast" ? 1_000 : 30_000)
    return () => clearInterval(t)
  }, [mode])
  return now
}

/** One peek row: 14px glyph slot + one truncated line. */
function PeekRow({ glyph, text, href }: { readonly glyph: string; readonly text: string; readonly href?: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="w-[14px] shrink-0 text-[10px] text-muted-foreground/70 text-right">{glyph}</span>
      {href ? (
        // A real link on the card (#779). `nodrag` is what keeps a mousedown
        // from starting a canvas drag (React Flow's drag filter checks the
        // class); `nopan` likewise; the click stopPropagation keeps the
        // (synthetic) click from selecting the node. Muted affordance —
        // #FF0073 stays reserved for actions.
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="nodrag nopan truncate text-[11px] text-foreground/80 hover:underline hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title={href}
        >
          {text}
        </a>
      ) : (
        <span className="truncate text-[11px] text-foreground/80">{text}</span>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-[14px]" />
          <span className="h-2.5 flex-1 rounded bg-muted-foreground/15 animate-pulse" style={{ maxWidth: `${88 - i * 14}%` }} />
        </div>
      ))}
    </div>
  )
}

function StatusDot({ color }: { readonly color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
}

function WebScrapeNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as WebScrapeNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const actor: ScraperActorId = nodeData.actor ?? "google-search"
  const actorLabel = SCRAPER_ACTOR_LABELS[actor]
  const summary = getActorSummary(nodeData)
  const credits = estimateNodeCredits({ type: "web-scrape", data: nodeData })
  const peek = WEB_SCRAPE_PEEK[actor]

  const state = deriveWebScrapeCardState(nodeData)
  const running = state.kind === "running"
  const hasAge = state.kind !== "never-ran" && !running && "at" in state && state.at !== undefined
  const now = useNowTick(running ? "fast" : hasAge ? "slow" : "off")

  const items = webScrapeItems(nodeData.generatedJson)
  const peekItems = items.slice(0, 3)

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Globe className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Globe className="h-4 w-4" />}
        category="input"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={220}
        hideHeader
        className={state.kind === "never-ran" ? "border-dashed" : undefined}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={HANDLES}
      >
        <div className="p-3 flex flex-col gap-1.5">
          {/* Identity block: actor + query, one truncated line each. */}
          <span className="text-[10px] font-medium uppercase tracking-wide text-[#38BDF8]">
            {actorLabel}
          </span>
          <p className="text-muted-foreground truncate max-w-[180px]">{summary}</p>

          {/* Everything below the divider is run state (#765). */}
          <div className="border-t border-border/60 -mx-1 my-0.5" />

          {state.kind === "never-ran" && (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <StatusDot color="var(--muted-foreground)" />
                  {t("node.notRunYet")}
                </span>
                <span className="text-muted-foreground/60">—</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70">{t("node.runToFetchResults")}</p>
            </>
          )}

          {state.kind === "running" && (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <StatusDot color="#38BDF8" />
                  {t("node.scraping")}
                </span>
                <span className="tabular-nums text-muted-foreground/80">{elapsedLabel(state.startedAt, now)}</span>
              </div>
              {/* Skeleton rows sit exactly where results land — no jump. */}
              <SkeletonRows />
            </>
          )}

          {state.kind !== "never-ran" && state.kind !== "running" && (
            <>
              {state.stale && (
                <div className="rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0.5">
                  {t("node.inputsChangedStale")}
                </div>
              )}
              <div className="flex items-center justify-between text-[11px]">
                {state.kind === "success" && (
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <StatusDot color="#22c55e" />
                    {state.count} {peek.countNoun}
                  </span>
                )}
                {state.kind === "empty" && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <StatusDot color="var(--muted-foreground)" />
                    Searched · 0 {peek.countNoun}
                  </span>
                )}
                {state.kind === "failed" && (
                  <span className="flex items-center gap-1.5 font-medium text-red-500">
                    <StatusDot color="#ef4444" />
                    {t("node.failed")}
                  </span>
                )}
                <span className="text-muted-foreground/60 tabular-nums">{relativeTime(state.at, now)}</span>
              </div>

              {state.kind === "success" && (
                <div className={`flex flex-col gap-1 ${state.stale ? "opacity-50" : ""}`}>
                  {peekItems.map((item, i) => (
                    <PeekRow key={i} glyph={peek.glyph(item, i)} text={webScrapePeekLine(actor, item)} href={webScrapeItemLink(actor, item)} />
                  ))}
                  {state.count > peekItems.length && (
                    <span className="text-[10px] text-[#FF0073]">{t("node.viewAllN", { n: state.count })}</span>
                  )}
                </div>
              )}

              {state.kind === "empty" && (
                <p className="text-[10px] text-muted-foreground/70 leading-snug">
                  {t("node.queryMatchedNothing")}
                </p>
              )}

              {state.kind === "failed" && (
                <p className="text-[10px] text-muted-foreground/80 leading-snug">
                  {nodeData.errorMessage || t("node.scrapeFailed")}
                  {state.kept && (
                    <>
                      {" "}
                      <span className="font-medium text-foreground/80">
                        {t(state.kept.count === 1 ? "node.previousResultKeptOne" : "node.previousResultKeptOther", {
                          n: state.kept.count,
                          when: state.kept.at ? `, ${relativeTime(state.kept.at, now)}` : "",
                        })}
                      </span>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="web-scrape" handleId="in"   type="target" position={Position.Left}  label="URL / Query" color={DATA_HANDLE_COLORS.text} icon={<Globe />}  side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="web-scrape" handleId="json" type="source" position={Position.Right} label="JSON"        color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const WebScrapeNode = memo(WebScrapeNodeComponent)

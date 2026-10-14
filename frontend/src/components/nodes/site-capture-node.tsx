"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Smartphone, Braces, Image as ImageIcon, Link2 } from "lucide-react"
import { siteCaptureStills } from "@nodaro/shared/nodes"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useScrapeNodeCredits } from "./use-scrape-node-credits"
import { elapsedLabel, relativeTime } from "./web-scrape-run-state"
import { isValidWebScrapeConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import type { SiteCaptureNodeData } from "@/types/nodes"

const ACCEPTS_IN = (t: string) => isValidWebScrapeConnection("in", t)

const HANDLES = [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
  { id: "image", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
] as const

/** 1 s while a capture runs (the elapsed counter), 30 s while there is an age to show, off otherwise. */
function useNowTick(mode: "off" | "slow" | "fast"): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (mode === "off") return
    const t = setInterval(() => setNow(Date.now()), mode === "fast" ? 1_000 : 30_000)
    return () => clearInterval(t)
  }, [mode])
  return now
}

function StatusDot({ color }: { readonly color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
}

function SiteCaptureNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SiteCaptureNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const credits = useScrapeNodeCredits(id, "site-capture", nodeData)

  const running = nodeData.executionStatus === "running"
  const stills = siteCaptureStills(nodeData.generatedJson)
  const failed = !running && nodeData.lastRunOutcome === "failed"
  const lastAt = failed ? nodeData.lastRunAt : stills.length > 0 ? nodeData.lastRunAt : undefined
  const now = useNowTick(running ? "fast" : lastAt !== undefined ? "slow" : "off")
  const typed = typeof nodeData.url === "string" ? nodeData.url.trim() : ""

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Smartphone className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Smartphone className="h-4 w-4" />}
        category="input"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={240}
        hideHeader
        className={stills.length === 0 && !running && !failed ? "border-dashed" : undefined}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={HANDLES}
      >
        <div className="p-3 flex flex-col gap-1.5">
          <p className="text-muted-foreground truncate max-w-[200px]" title={typed || undefined}>
            {typed || t("node.siteCaptureFromInput")}
          </p>

          <div className="border-t border-border/60 -mx-1 my-0.5" />

          {running && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <StatusDot color="#38BDF8" />
                {t("node.capturing")}
              </span>
              <span className="tabular-nums text-muted-foreground/80">{elapsedLabel(nodeData.lastRunStartedAt, now)}</span>
            </div>
          )}

          {!running && stills.length === 0 && !failed && (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <StatusDot color="var(--muted-foreground)" />
                {t("node.notRunYet")}
              </div>
              <p className="text-[10px] text-muted-foreground/70">{t("node.runToCapture")}</p>
            </>
          )}

          {!running && failed && (
            <p className="text-[10px] text-muted-foreground/80 leading-snug">
              <span className="flex items-center gap-1.5 font-medium text-red-500 text-[11px]">
                <StatusDot color="#ef4444" />
                {t("node.failed")}
              </span>
              {nodeData.errorMessage || t("node.captureFailed")}
              {stills.length > 0 && <> {t("node.previousCaptureKept")}</>}
            </p>
          )}

          {!running && stills.length > 0 && (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <StatusDot color="#22c55e" />
                  {t("node.stillsCount", { n: stills.length })}
                </span>
                {lastAt !== undefined && <span className="text-muted-foreground/60 tabular-nums">{relativeTime(lastAt, now)}</span>}
              </div>
              <div className={`grid grid-cols-4 gap-1 ${failed ? "opacity-50" : ""}`}>
                {stills.map((still) => (
                  <CachedImage
                    key={still.url}
                    src={still.url}
                    alt={still.label}
                    title={still.label}
                    thumbnail
                    thumbnailWidth={120}
                    className="w-full aspect-[21/25] object-cover object-top rounded-sm border border-border/60"
                    draggable={false}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="site-capture" handleId="in" type="target" position={Position.Left} label="Page URL" color={DATA_HANDLE_COLORS.text} icon={<Link2 />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="site-capture" handleId="image" type="source" position={Position.Right} label="Stills" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="site-capture" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
    </div>
  )
}

export const SiteCaptureNode = memo(SiteCaptureNodeComponent)

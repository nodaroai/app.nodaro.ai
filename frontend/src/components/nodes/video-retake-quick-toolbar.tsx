"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useStore } from "@xyflow/react"
import { Sparkles, Ratio, Settings2, Copy, RefreshCw } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RatioIcon } from "@/components/editor/config-panels/aspect-ratio-selector"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import type { VideoRetakeData } from "@/types/nodes"

interface VideoRetakeQuickToolbarProps {
  readonly nodeId: string
  readonly data: VideoRetakeData
  readonly credits: number
  readonly isRunning: boolean
  /** Fires whenever a select / popover inside the toolbar opens or closes.
   *  Mirrors GenerateImageQuickToolbar — the parent uses this to pin the
   *  NodeToolbar visible while a dropdown is active (Radix portals items
   *  outside the node's hover area, which would otherwise hide it). */
  readonly onAnyOpenChange?: (open: boolean) => void
}

/**
 * Hover-revealed toolbar that sits below a Retake Video node. Mirrors
 * `generate-image-quick-toolbar.tsx` structure but with retake-specific
 * controls:
 *
 *  - Model: locked to LTX 2.3 Pro (single-option dropdown — rendered for
 *    forward-compat consistency with the canonical UX).
 *  - Aspect: 16:9 / 9:16 (LTX retake supports these two).
 *  - Mode: replace audio / replace video / replace both (the LTX
 *    retake-mode parameter — distinct from aspect/resolution).
 *  - Versions: 1-4 (`data.repeatCount`).
 *  - Run: <RunNodeButton>. Credit math is per-second (`ltx-2.3-pro-retake:
 *    per-second` = 50cr) × `data.retakeDuration` — the parent node
 *    computes this and passes `credits` as the per-press cost.
 *
 * Compact-mode threshold + deferred-close pattern preserved verbatim from
 * the canonical implementation (load-bearing — the close-decrement defer
 * is what keeps the bar visible when the user switches dropdowns).
 */
const MODEL_OPTIONS = [
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro", desc: "Lightricks · per-second retake" },
] as const

const ASPECT_OPTIONS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
] as const

const MODE_OPTIONS = [
  { value: "replace_audio", label: "Replace audio" },
  { value: "replace_video", label: "Replace video" },
  { value: "replace_audio_and_video", label: "Replace both" },
] as const

export function VideoRetakeQuickToolbar({
  nodeId,
  data,
  credits,
  isRunning,
  onAnyOpenChange,
}: VideoRetakeQuickToolbarProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  // Compact-mode threshold — see generate-image-quick-toolbar.tsx for full
  // rationale. Slightly narrower natural width here because the LTX node
  // has fewer + shorter chips (model is single-option, no resolution).
  const TOOLBAR_NATURAL_WIDTH = 380
  const nodeWidth = useWorkflowStore((s) => {
    const n = s.nodes.find((nn) => nn.id === nodeId)
    const w = (n?.width as number | undefined) ?? (n?.measured?.width as number | undefined)
    return typeof w === "number" && w > 0 ? w : 320
  })
  const zoom = useStore((s) => s.transform[2])
  const visibleNodeWidth = nodeWidth * zoom
  const isCompact = TOOLBAR_NATURAL_WIDTH > visibleNodeWidth * 1.5

  // Zoom-aware scale with 75% floor (canonical canvas convention).
  const toolbarScale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  const toolbarTransform = {
    transform: `scale(${toolbarScale})`,
    transformOrigin: "50% 0%",
  } as const

  // Deferred-close pattern — load-bearing. See canonical for full rationale.
  const [openCount, setOpenCount] = useState(0)
  const pendingCloseRef = useRef<number | null>(null)
  useEffect(() => {
    onAnyOpenChange?.(openCount > 0)
  }, [openCount, onAnyOpenChange])
  useEffect(() => () => {
    if (pendingCloseRef.current !== null) {
      clearTimeout(pendingCloseRef.current)
    }
  }, [])
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      setOpenCount((c) => c + 1)
    } else {
      pendingCloseRef.current = window.setTimeout(() => {
        pendingCloseRef.current = null
        setOpenCount((c) => Math.max(0, c - 1))
      }, 0)
    }
  }, [])

  const currentProvider = data.provider ?? "ltx-2.3-pro"
  const currentAspect = data.aspectRatio ?? "16:9"
  const currentMode = data.retakeMode ?? "replace_audio_and_video"
  const repeatCount = Math.min(Math.max(1, (data.repeatCount as number | undefined) ?? 1), 4)

  const modelEntry = useMemo(
    () => MODEL_OPTIONS.find((m) => m.value === currentProvider) ?? MODEL_OPTIONS[0],
    [currentProvider],
  )
  const modelLabel = modelEntry.label
  const modelShort = "LTX Pro"
  const aspectShort = currentAspect
  const modeShort = useMemo(() => {
    const m = MODE_OPTIONS.find((o) => o.value === currentMode)?.label ?? currentMode
    // Strip leading "Replace " to keep the pill compact ("audio" / "video" / "both").
    return m.replace(/^Replace\s+/i, "").toLowerCase()
  }, [currentMode])

  const handleModelChange = (value: string) => {
    updateNodeData(nodeId, { provider: value })
  }
  const handleAspectChange = (value: string) => {
    updateNodeData(nodeId, { aspectRatio: value })
  }
  const handleModeChange = (value: string) => {
    updateNodeData(nodeId, { retakeMode: value })
  }
  const handleRepeatChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { repeatCount: Number.isFinite(n) ? n : 1 })
  }

  // Ghost-style classes copied verbatim from the canonical implementation
  // so the visual hierarchy of every quick toolbar in the editor matches.
  const ghostTriggerClass =
    "!h-6 !px-1.5 !gap-1 !border-0 !bg-transparent text-[10px] " +
    "text-neutral-900/85 hover:!bg-black/10 dark:text-white/85 dark:hover:!bg-white/10 " +
    "rounded-md min-w-0 w-auto whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-70 " +
    "[&[data-state=open]]:bg-black/10 dark:[&[data-state=open]]:bg-white/10"

  const ghostPopoverTriggerClass =
    "!h-8 !px-2 !gap-1.5 !border-0 !bg-transparent text-xs w-full " +
    "text-foreground hover:!bg-black/5 dark:hover:!bg-white/10 " +
    "rounded-md whitespace-nowrap [&_svg]:!size-3.5 [&_svg]:opacity-70 " +
    "[&[data-state=open]]:bg-black/5 dark:[&[data-state=open]]:bg-white/10"

  const containerClass =
    "flex items-center px-1.5 py-1 backdrop-blur-sm rounded-xl border " +
    "bg-white/85 border-black/10 text-neutral-900 " +
    "dark:bg-black/60 dark:border-white/10 dark:text-white"

  // ── Compact mode ───────────────────────────────────────────────────────
  if (isCompact) {
    const summary = `${modelShort} · ${aspectShort} · ${modeShort}`
    return (
      <div
        className={`${containerClass} gap-1.5`}
        style={toolbarTransform}
        onClick={(e) => e.stopPropagation()}
      >
        <Popover onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 h-6 px-2 text-[10px] rounded-md whitespace-nowrap text-neutral-900/85 hover:bg-black/10 dark:text-white/85 dark:hover:bg-white/10"
              title="Settings"
            >
              <Settings2 className="w-3 h-3 opacity-70" />
              <span className="font-medium">{summary}</span>
              {repeatCount > 1 && (
                <span className="font-medium opacity-80">× {repeatCount}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={8}
            className="w-[240px] p-2 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ToolbarSetting label="Model" icon={<Sparkles className="w-3 h-3" />}>
              <Select value={currentProvider} onValueChange={handleModelChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarSetting>
            <ToolbarSetting label="Aspect" icon={<Ratio className="w-3 h-3" />}>
              <Select value={currentAspect} onValueChange={handleAspectChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_OPTIONS.map((opt) => (
                    <AspectRatioItem key={opt.value} value={opt.value} label={opt.label} />
                  ))}
                </SelectContent>
              </Select>
            </ToolbarSetting>
            <ToolbarSetting label="Mode" icon={<RefreshCw className="w-3 h-3" />}>
              <Select value={currentMode} onValueChange={handleModeChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarSetting>
            <ToolbarSetting label="Versions" icon={<Copy className="w-3 h-3" />}>
              <Select value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      × {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarSetting>
          </PopoverContent>
        </Popover>
        <PinkDot />
        <RunNodeButton
          nodeId={nodeId}
          credits={credits}
          isRunning={isRunning}
          onRun={(nid) => runSingleNode?.(nid)}
        />
      </div>
    )
  }

  // ── Default mode ───────────────────────────────────────────────────────
  return (
    <div
      className={`${containerClass} gap-0.5`}
      style={toolbarTransform}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Model selector — locked to LTX 2.3 Pro for now, dropdown rendered
          for forward-compat (additional retake providers slot in here). */}
      <Select value={currentProvider} onValueChange={handleModelChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={`${ghostTriggerClass} max-w-[180px]`}>
          <Sparkles className="opacity-70" />
          <SelectValue>{modelLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODEL_OPTIONS.map((m) => (
            <SelectItem key={m.value} value={m.value} className="text-xs">
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Aspect ratio selector */}
      <Select value={currentAspect} onValueChange={handleAspectChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass}>
          <Ratio className="opacity-70" />
          <SelectValue>{aspectShort}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ASPECT_OPTIONS.map((opt) => (
            <AspectRatioItem key={opt.value} value={opt.value} label={opt.label} />
          ))}
        </SelectContent>
      </Select>

      {/* Mode selector — 3-way replace-audio / replace-video / replace-both */}
      <Select value={currentMode} onValueChange={handleModeChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass}>
          <RefreshCw className="opacity-70" />
          <SelectValue>{modeShort}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Versions */}
      <Select value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass} title="Versions per run">
          <Copy className="opacity-70" />
          <SelectValue>× {repeatCount}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {[1, 2, 3, 4].map((n) => (
            <SelectItem key={n} value={String(n)} className="text-xs">
              × {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <PinkDot />

      <RunNodeButton
        nodeId={nodeId}
        credits={credits}
        isRunning={isRunning}
        onRun={(nid) => runSingleNode?.(nid)}
      />
    </div>
  )
}

/** Aspect-ratio dropdown item — mirrors the canonical implementation so
 *  the visual rhythm of every quick toolbar stays consistent. */
function AspectRatioItem({ value, label }: { value: string; label: string }) {
  return (
    <SelectItem value={value} className="text-xs pr-8">
      <span className="flex w-full items-center gap-2">
        <span className="text-muted-foreground shrink-0">
          <RatioIcon value={value} label={label} />
        </span>
        <span className="flex-1">{label}</span>
      </span>
    </SelectItem>
  )
}

/** 4px brand-pink dot — divider between settings and the Run CTA. */
function PinkDot() {
  return (
    <span
      aria-hidden
      className="w-1 h-1 rounded-full bg-[#ff0073] mx-1.5 shrink-0"
    />
  )
}

/** Row inside the compact-mode popover. */
function ToolbarSetting({
  label,
  icon,
  children,
}: {
  label: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  )
}

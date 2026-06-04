"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useStore } from "@xyflow/react"
import { Sparkles, Ratio, Maximize2, Clock, Settings2, Copy, Layers } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  VIDEO_GEN_MODELS,
  VIDEO_RESOLUTION_OPTIONS,
  getAspectRatiosForVideoModel,
  getDurationsForVideoModel,
  getVideoModelCapabilitiesTooltip,
} from "@/components/editor/config-panels/model-options"
import { ModelSearchSelect } from "@/components/editor/config-panels/model-search-select"
import { RatioIcon } from "@/components/editor/config-panels/aspect-ratio-selector"
import { RunNodeButton } from "./run-node-button"
import { PromptEditButton } from "./prompt-edit-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import { isSeedance2Provider } from "@nodaro/shared"
import type { GenerateVideoNodeData } from "@/types/nodes"

interface GenerateVideoQuickToolbarProps {
  readonly nodeId: string
  readonly data: GenerateVideoNodeData
  readonly credits: number
  readonly isRunning: boolean
  /** Fires whenever a select / popover inside the toolbar opens or closes.
   *  The parent uses this to keep the toolbar visible while a dropdown is
   *  active (the dropdown items render in a portal outside the node's
   *  hover area, which would otherwise trigger NodeToolbar's hide). */
  readonly onAnyOpenChange?: (open: boolean) => void
}

/**
 * Hover-revealed toolbar that sits below a Generate Video node
 * (`topToolbarContent` position). Exposes the most-tweaked settings as
 * inline dropdowns alongside the Run button: model, aspect ratio,
 * duration, resolution, versions.
 *
 * Two visual modes, switched on the visible (post-zoom) node width:
 *  - Default (wide enough): ghost selects with icon prefixes, separated
 *    from the Run CTA by a 4px pink dot.
 *  - Compact (narrow node OR zoomed out): collapses to a single
 *    "VEO3.1 · 16:9 · 8s · 1080p"-style pill that opens a Popover with the
 *    same controls grouped — the popover renders at its own fixed-DOM scale
 *    so the user can still read/click the dropdowns.
 */
export function GenerateVideoQuickToolbar({
  nodeId,
  data,
  credits,
  isRunning,
  onAnyOpenChange,
}: GenerateVideoQuickToolbarProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  // Compact threshold = (toolbar natural width) > 1.5 × (visible node width).
  // The toolbar renders at fixed DOM scale (NodeToolbar's portal isn't
  // zoom-scaled), while the node IS scaled by the canvas zoom. So when
  // the canvas zooms out far OR the user resizes the node narrow, the
  // toolbar visually dwarfs the node — collapse to the single pill.
  // TOOLBAR_NATURAL_WIDTH is wider than the gen-image variant because
  // generate-video adds a Duration dropdown to the strip (5 ghost selects
  // + dot + run button vs 4 + dot + run on the image side).
  const TOOLBAR_NATURAL_WIDTH = 460
  const nodeWidth = useWorkflowStore((s) => {
    const n = s.nodes.find((nn) => nn.id === nodeId)
    const w = (n?.width as number | undefined) ?? (n?.measured?.width as number | undefined)
    return typeof w === "number" && w > 0 ? w : 320
  })
  const zoom = useStore((s) => s.transform[2])
  const visibleNodeWidth = nodeWidth * zoom
  const isCompact = TOOLBAR_NATURAL_WIDTH > visibleNodeWidth * 1.5

  // NodeToolbar renders at fixed DOM scale (its portal sits outside the
  // React Flow zoom transform), so its visual size doesn't track zoom by
  // default. We want the toolbar to grow when the user zooms in (matches
  // the node's growth) while staying readable when zoomed out — so apply
  // `scale(max(MIN, zoom))`. transformOrigin top-center keeps the toolbar
  // anchored to the node's bottom edge as it scales.
  const toolbarScale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  const toolbarTransform = {
    transform: `scale(${toolbarScale})`,
    transformOrigin: "50% 0%",
  } as const

  // Open-state tracking: increment on each select/popover open, decrement
  // on close. While count > 0 we report `open=true` upward so the parent
  // can pin the NodeToolbar visible past the cursor leaving the node
  // (Radix Select items render in a portal outside the node's hover
  // boundary — without this the bar disappears mid-pick).
  //
  // Closes are deferred to the next macrotask so that clicking directly
  // from one open dropdown's trigger onto another's trigger keeps the
  // count net positive. Without the defer, the close → open sequence
  // produces two separate renders (count 1 → 0 → 1); the intermediate
  // 0 fires the useEffect with `open=false`, the parent unpins the
  // NodeToolbar, and since the cursor sits over the portaled menu
  // (outside the node's hover boundary) the toolbar disappears mid-pick.
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

  const currentProvider = data.provider || "seedance-2-fast"

  const modelEntry = useMemo(
    () => VIDEO_GEN_MODELS.find((m) => m.value === currentProvider),
    [currentProvider],
  )
  const modelLabel = modelEntry?.label ?? currentProvider
  // Short-form label for the compact pill (drops vendor prefix, fits ~10 chars).
  const modelShort = useMemo(() => {
    const lbl = modelEntry?.label ?? currentProvider
    return lbl.length > 12 ? lbl.slice(0, 11).trimEnd() + "…" : lbl
  }, [modelEntry?.label, currentProvider])

  const aspectOptions = useMemo(() => getAspectRatiosForVideoModel(currentProvider), [currentProvider])
  const durationOptions = useMemo(() => getDurationsForVideoModel(currentProvider), [currentProvider])
  const resolutionOptions = VIDEO_RESOLUTION_OPTIONS[currentProvider]
  // The unified GenerateVideoNodeData picks up a `[key: string]: unknown`
  // index signature via the underlying ImageToVideoData / TextToVideoData
  // intersection — explicit fields like `resolution` survive the Omit, but
  // their inferred type widens to `unknown`-ish when accessed. Coerce to a
  // string at the read boundary; the dropdowns + payload builders all
  // expect strings.
  const currentAspect: string = (typeof data.aspectRatio === "string" ? data.aspectRatio : undefined) ?? aspectOptions[0]?.value ?? ""
  const currentDuration: number | undefined =
    (typeof data.duration === "number" ? data.duration : undefined) ??
    durationOptions[0]?.value
  const currentResolution: string = (typeof data.resolution === "string" ? data.resolution : undefined) ?? resolutionOptions?.[0]?.value ?? ""

  // Short labels for the pill — strips the parenthetical descriptor that
  // option labels often carry ("1080p (High)" → "1080p", "16:9 (Landscape)" →
  // "16:9"). The full label still renders inside the dropdown items.
  const aspectShort = shortenLabel(aspectOptions.find((o) => o.value === currentAspect)?.label ?? currentAspect)
  const resolutionShort = shortenLabel(resolutionOptions?.find((o) => o.value === currentResolution)?.label ?? currentResolution)
  const durationShort = currentDuration !== undefined ? `${currentDuration}s` : ""

  // Versions / repeat count — how many results to generate per run.
  // Clamped to 1-4 in this UI (the shared helper allows up to 20; we
  // intentionally narrow the toolbar to a sensible default range — power
  // users can override via the full settings panel if/when that surfaces
  // the wider range).
  const repeatCount = Math.min(Math.max(1, (data.repeatCount as number | undefined) ?? 1), 4)
  const handleRepeatChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { repeatCount: Number.isFinite(n) ? n : 1 })
  }

  const handleModelChange = (value: string) => {
    updateNodeData(nodeId, { provider: value })
  }
  const handleAspectChange = (value: string) => {
    updateNodeData(nodeId, { aspectRatio: value })
  }
  const handleDurationChange = (value: string) => {
    const n = parseInt(value, 10)
    if (Number.isFinite(n)) {
      updateNodeData(nodeId, { duration: n })
    }
  }
  const handleResolutionChange = (value: string) => {
    updateNodeData(nodeId, { resolution: value })
  }

  // Seedance 2 input mode — mutually exclusive between Frames (start/end
  // images) and References (image references). Visible only when the
  // chosen provider is in the Seedance 2 family; drives the disabled-handle
  // styling via `getHandleConnectionLimit`.
  const isSeedance2 = isSeedance2Provider(currentProvider)
  const currentSeedance2Mode: "frames" | "references" =
    (data.seedance2InputMode as "frames" | "references" | undefined) ?? "frames"
  const handleSeedance2ModeChange = (value: string) => {
    if (value === "frames" || value === "references") {
      updateNodeData(nodeId, { seedance2InputMode: value })
    }
  }
  const seedance2ModeLabel = currentSeedance2Mode === "frames" ? "Frames" : "Refs"

  // Ghost select trigger — no border, no background by default, subtle
  // hover only. Icon prefix + value + small chevron. `!` modifiers beat
  // shadcn's data-[size]:* attribute defaults. Light + dark mode variants:
  // light mode is dark text on a near-transparent base with a faint hover;
  // dark mode is light text on the same.
  const ghostTriggerClass =
    "!h-6 !px-1.5 !gap-1 !border-0 !bg-transparent text-[10px] " +
    "text-neutral-900/85 hover:!bg-black/10 dark:text-white/85 dark:hover:!bg-white/10 " +
    "rounded-md min-w-0 w-auto whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-70 " +
    "[&[data-state=open]]:bg-black/10 dark:[&[data-state=open]]:bg-white/10"

  // Popover variant — same ghost look but taller + full-width so the
  // touch target inside the floating panel is comfortable. Used by the
  // compact-mode Popover's rows.
  const ghostPopoverTriggerClass =
    "!h-8 !px-2 !gap-1.5 !border-0 !bg-transparent text-xs w-full " +
    "text-foreground hover:!bg-black/5 dark:hover:!bg-white/10 " +
    "rounded-md whitespace-nowrap [&_svg]:!size-3.5 [&_svg]:opacity-70 " +
    "[&[data-state=open]]:bg-black/5 dark:[&[data-state=open]]:bg-white/10"

  // Container colors — bright translucent surface in light mode, dark
  // translucent in dark mode. Matches the rest of the editor's surface
  // hierarchy.
  const containerClass =
    "flex items-center px-1.5 py-1 backdrop-blur-sm rounded-xl border " +
    "bg-white/85 border-black/10 text-neutral-900 " +
    "node-menu-surface dark:border-white/10 dark:text-white"

  // ── Compact mode (low zoom): one pill that opens a popover ─────────────
  if (isCompact) {
    const summary = [
      modelShort,
      isSeedance2 ? seedance2ModeLabel : null,
      aspectShort || currentAspect,
      durationShort,
      resolutionShort,
    ].filter(Boolean).join(" · ")
    return (
      <div
        className={`${containerClass} gap-1.5`}
        style={toolbarTransform}
        onClick={(e) => e.stopPropagation()}
      >
        <PromptEditButton nodeId={nodeId} compact />
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
            className="w-[240px] p-2 space-y-2 node-menu-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <ToolbarSetting label="Model" icon={<Sparkles className="w-3 h-3" />}>
              <ModelSearchSelect disabled={isRunning}
                value={currentProvider}
                onChange={handleModelChange}
                onOpenChange={handleOpenChange}
                options={VIDEO_GEN_MODELS}
                getTooltip={getVideoModelCapabilitiesTooltip}
                triggerClassName={ghostPopoverTriggerClass}
                contentClassName="node-menu-surface"
                ariaLabel="Model"
              />
            </ToolbarSetting>
            {isSeedance2 && (
              <ToolbarSetting label="Mode" icon={<Layers className="w-3 h-3" />}>
                <Select disabled={isRunning} value={currentSeedance2Mode} onValueChange={handleSeedance2ModeChange} onOpenChange={handleOpenChange}>
                  <SelectTrigger className={ghostPopoverTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="node-menu-surface">
                    <SelectItem value="frames" className="text-xs">Frames (start/end images)</SelectItem>
                    <SelectItem value="references" className="text-xs">References (image refs)</SelectItem>
                  </SelectContent>
                </Select>
              </ToolbarSetting>
            )}
            {aspectOptions.length > 0 && (
              <ToolbarSetting label="Aspect" icon={<Ratio className="w-3 h-3" />}>
                <Select disabled={isRunning} value={currentAspect} onValueChange={handleAspectChange} onOpenChange={handleOpenChange}>
                  <SelectTrigger className={ghostPopoverTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="node-menu-surface">
                    {aspectOptions.map((opt) => (
                      <AspectRatioItem key={opt.value} value={opt.value} label={opt.label} />
                    ))}
                  </SelectContent>
                </Select>
              </ToolbarSetting>
            )}
            {durationOptions.length > 0 && (
              <ToolbarSetting label="Duration" icon={<Clock className="w-3 h-3" />}>
                <Select
                  value={currentDuration !== undefined ? String(currentDuration) : ""}
                  onValueChange={handleDurationChange}
                  onOpenChange={handleOpenChange}
                >
                  <SelectTrigger className={ghostPopoverTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="node-menu-surface">
                    {durationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ToolbarSetting>
            )}
            {resolutionOptions && resolutionOptions.length > 0 && (
              <ToolbarSetting label="Resolution" icon={<Maximize2 className="w-3 h-3" />}>
                <Select disabled={isRunning} value={currentResolution} onValueChange={handleResolutionChange} onOpenChange={handleOpenChange}>
                  <SelectTrigger className={ghostPopoverTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="node-menu-surface">
                    {resolutionOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ToolbarSetting>
            )}
            <ToolbarSetting label="Versions" icon={<Copy className="w-3 h-3" />}>
              <Select disabled={isRunning} value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="node-menu-surface">
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
        <RunNodeButton
          nodeId={nodeId}
          credits={credits}
          isRunning={isRunning}
          onRun={(nid) => runSingleNode?.(nid)}
        />
      </div>
    )
  }

  // ── Default mode: ghost selects with icon prefixes ─────────────────────
  return (
    <div
      className={`${containerClass} gap-0.5`}
      style={toolbarTransform}
      onClick={(e) => e.stopPropagation()}
    >
      <PromptEditButton nodeId={nodeId} />
      {/* Model selector */}
      <ModelSearchSelect disabled={isRunning}
        value={currentProvider}
        onChange={handleModelChange}
        onOpenChange={handleOpenChange}
        options={VIDEO_GEN_MODELS}
        getTooltip={getVideoModelCapabilitiesTooltip}
        triggerLabel={modelLabel}
        triggerIcon={<Sparkles className="opacity-70" />}
        triggerClassName={`${ghostTriggerClass} max-w-[180px]`}
        contentClassName="node-menu-surface"
        ariaLabel="Model"
      />

      {/* Seedance 2 input mode (Frames vs References) — only when relevant */}
      {isSeedance2 && (
        <Select disabled={isRunning} value={currentSeedance2Mode} onValueChange={handleSeedance2ModeChange} onOpenChange={handleOpenChange}>
          <SelectTrigger className={ghostTriggerClass} title="Input mode (Seedance 2)">
            <Layers className="opacity-70" />
            <SelectValue>{seedance2ModeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            <SelectItem value="frames" className="text-xs">Frames (start/end images)</SelectItem>
            <SelectItem value="references" className="text-xs">References (image refs)</SelectItem>
          </SelectContent>
        </Select>
      )}

      {/* Aspect ratio selector */}
      {aspectOptions.length > 0 && (
        <Select disabled={isRunning} value={currentAspect} onValueChange={handleAspectChange} onOpenChange={handleOpenChange}>
          <SelectTrigger className={ghostTriggerClass}>
            <Ratio className="opacity-70" />
            <SelectValue>{aspectShort}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            {aspectOptions.map((opt) => (
              <AspectRatioItem key={opt.value} value={opt.value} label={opt.label} />
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Duration selector (only when the provider exposes one) */}
      {durationOptions.length > 0 && (
        <Select
          value={currentDuration !== undefined ? String(currentDuration) : ""}
          onValueChange={handleDurationChange}
          onOpenChange={handleOpenChange}
        >
          <SelectTrigger className={ghostTriggerClass}>
            <Clock className="opacity-70" />
            <SelectValue>{durationShort}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            {durationOptions.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Resolution selector (only when the provider exposes one) */}
      {resolutionOptions && resolutionOptions.length > 0 && (
        <Select disabled={isRunning} value={currentResolution} onValueChange={handleResolutionChange} onOpenChange={handleOpenChange}>
          <SelectTrigger className={ghostTriggerClass}>
            <Maximize2 className="opacity-70" />
            <SelectValue>{resolutionShort}</SelectValue>
          </SelectTrigger>
          <SelectContent className="node-menu-surface">
            {resolutionOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Versions (×1–×4): how many results to generate per run. */}
      <Select disabled={isRunning} value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass} title="Versions per run">
          <Copy className="opacity-70" />
          <SelectValue>× {repeatCount}</SelectValue>
        </SelectTrigger>
        <SelectContent className="node-menu-surface">
          {[1, 2, 3, 4].map((n) => (
            <SelectItem key={n} value={String(n)} className="text-xs">
              × {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>


      {/* Run button — credits + run-multiplier already baked in. */}
      <RunNodeButton
        nodeId={nodeId}
        credits={credits}
        isRunning={isRunning}
        onRun={(nid) => runSingleNode?.(nid)}
      />
    </div>
  )
}

/** Aspect-ratio dropdown item: proportional rectangle icon on the left,
 *  text label to its right. Icon-led layout makes the ratio visually
 *  scannable — eye lands on the shape before reading the label. Same
 *  `RatioIcon` SVG as the full config panel's tile grid. */
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

/** Strips the parenthetical descriptor from an option label.
 *    "1080p (High)"     → "1080p"
 *    "16:9 (Landscape)" → "16:9"
 *    "1:1"              → "1:1"  (no parens, returned as-is)
 *  Used so the toolbar pill shows the dense identifier while the dropdown
 *  options keep the descriptive long form. */
function shortenLabel(label: string): string {
  const parenIdx = label.indexOf(" (")
  return parenIdx > 0 ? label.slice(0, parenIdx) : label
}


/** Row inside the compact-mode popover: small icon + label on top, full-
 *  width select underneath. Mirrors the config-panel field rhythm. */
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

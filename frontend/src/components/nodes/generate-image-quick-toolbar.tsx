"use client"

import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { useStore } from "@xyflow/react"
import { InlineGluedStripContext } from "./inline-glued-strip-context"
import { Sparkles, Ratio, Maximize2, Settings2, Copy } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IMAGE_GEN_MODELS } from "@/components/editor/config-panels/model-options"
import { ModelSearchSelect } from "@/components/editor/config-panels/model-search-select"
import { AspectRatioItem } from "@/components/editor/config-panels/aspect-ratio-selector"
import { RunNodeButton } from "./run-node-button"
import { PromptEditButton } from "./prompt-edit-button"
import { NodeRunStripControls } from "./node-run-strip-controls"
import { useGenerateImageStripModel } from "./use-generate-image-strip-model"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import { useNodeVisuallyCompact } from "@/lib/node-visual-compact"
import type { GenerateImageData } from "@/types/nodes"

interface GenerateImageQuickToolbarProps {
  readonly nodeId: string
  readonly data: GenerateImageData
  readonly credits: number
  readonly isRunning: boolean
  /** Fires whenever a select / popover inside the toolbar opens or closes.
   *  The parent uses this to keep the toolbar visible while a dropdown is
   *  active (the dropdown items render in a portal outside the node's
   *  hover area, which would otherwise trigger NodeToolbar's hide). */
  readonly onAnyOpenChange?: (open: boolean) => void
}

/**
 * Hover-revealed toolbar that sits below a Generate Image node
 * (`topToolbarContent` position). Exposes the three most-tweaked settings
 * as inline dropdowns alongside the Run button.
 *
 * Two visual modes, switched on React Flow zoom:
 *  - Default (zoom ≥ 0.7): ghost selects with icon prefixes (model /
 *    aspect / resolution), separated from the Run CTA by a 4px pink dot.
 *  - Compact (zoom < 0.7, harder to read fine text): collapses to a
 *    single "NB2 · 3:4 · 2K"-style pill that opens a Popover with the
 *    three full controls grouped — the popover renders at its own
 *    fixed-DOM scale so the user can still read/click the dropdowns.
 *
 * Multi-provider mode (2+ models selected) replaces the model dropdown
 * with a static "N models" chip and directs the user to the full config
 * panel for cohort edits.
 */
export function GenerateImageQuickToolbar({
  nodeId,
  data,
  credits,
  isRunning,
  onAnyOpenChange,
}: GenerateImageQuickToolbarProps) {
  // Collapse to the single summary pill when the node is visually compact.
  // Shared threshold (`useNodeVisuallyCompact`) with the typed-handle labels,
  // so the toolbar and the pip labels switch modes at the exact same
  // on-screen size — whether the canvas is zoomed out or the node is resized
  // narrow.
  const isCompact = useNodeVisuallyCompact(nodeId)
  const zoom = useStore((s) => s.transform[2])

  // NodeToolbar renders at fixed DOM scale (its portal sits outside the
  // React Flow zoom transform), so its visual size doesn't track zoom by
  // default. We want the toolbar to grow when the user zooms in (matches
  // the node's growth) while staying readable when zoomed out — so apply
  // `scale(max(MIN, zoom))`. transformOrigin top-center keeps the toolbar
  // anchored to the node's bottom edge as it scales.
  const toolbarScale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  // When glued inside the node (inline mode), the viewport already applies
  // scale(zoom), so self-scaling here would double-scale — drop the transform.
  const glued = useContext(InlineGluedStripContext)
  const toolbarTransform = glued
    ? undefined
    : ({ transform: `scale(${toolbarScale})`, transformOrigin: "50% 0%" } as const)

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

  // Single source for the model/aspect/resolution/repeat derivation + handlers
  // + run action — SHARED with the inline in-body run strip via this hook so
  // the two surfaces can never disagree (provider-enum-sync hazard). The
  // compact branch below still reads `modelShort`/`aspectShort`/`resolutionShort`
  // from here for its summary pill.
  const {
    isMulti,
    modelLabel,
    modelShort,
    currentProvider,
    aspectOptions,
    currentAspect,
    aspectShort,
    resolutionOptions,
    currentResolution,
    resolutionShort,
    repeatCount,
    onModelChange: handleModelChange,
    onAspectChange: handleAspectChange,
    onResolutionChange: handleResolutionChange,
    onRepeatChange: handleRepeatChange,
    runSingleNode,
  } = useGenerateImageStripModel(nodeId, data)

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
  // compact-mode Popover's 4 rows.
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
    const summary = `${modelShort} · ${aspectShort || currentAspect}${resolutionShort ? ` · ${resolutionShort}` : ""}`
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
              {isMulti ? (
                <span className="text-xs text-muted-foreground italic px-2">
                  Multi-provider — open node settings to edit
                </span>
              ) : (
                <ModelSearchSelect disabled={isRunning}
                  value={currentProvider}
                  onChange={handleModelChange}
                  onOpenChange={handleOpenChange}
                  options={IMAGE_GEN_MODELS}
                  triggerClassName={ghostPopoverTriggerClass}
                  contentClassName="node-menu-surface"
                  ariaLabel="Model"
                />
              )}
            </ToolbarSetting>
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
  // The PILL presentation (container/zoom transform/click isolation/open
  // tracking) stays here; the inner control row is the shared
  // <NodeRunStripControls> so the inline in-body strip renders the exact
  // same controls from the exact same hook.
  return (
    <div
      className={`${containerClass} gap-0.5`}
      style={toolbarTransform}
      onClick={(e) => e.stopPropagation()}
    >
      <NodeRunStripControls
        nodeId={nodeId}
        isRunning={isRunning}
        credits={credits}
        onRun={(nid) => runSingleNode?.(nid)}
        onOpenChange={handleOpenChange}
        isMulti={isMulti}
        modelLabel={modelLabel}
        currentProvider={currentProvider}
        modelOptions={IMAGE_GEN_MODELS}
        onModelChange={handleModelChange}
        aspectOptions={aspectOptions}
        currentAspect={currentAspect}
        aspectShort={aspectShort}
        onAspectChange={handleAspectChange}
        resolutionOptions={resolutionOptions}
        currentResolution={currentResolution}
        resolutionShort={resolutionShort}
        onResolutionChange={handleResolutionChange}
        repeatCount={repeatCount}
        onRepeatChange={handleRepeatChange}
        ghostTriggerClass={ghostTriggerClass}
      />
    </div>
  )
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

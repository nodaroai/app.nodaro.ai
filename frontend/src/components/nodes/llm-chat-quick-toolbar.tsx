"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useStore } from "@xyflow/react"
import { Sparkles, LayoutTemplate, Repeat2, Settings2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemWithMeta,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RunNodeButton } from "./run-node-button"
import { PromptEditButton } from "./prompt-edit-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { GENERATE_TEXT_TEMPLATES } from "@/lib/generate-text-templates"
import type { LLMChatData } from "@/types/nodes"

const TIER_LABELS: Record<string, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
}

interface LlmChatQuickToolbarProps {
  readonly nodeId: string
  readonly data: LLMChatData
  readonly credits: number
  readonly isRunning: boolean
  /** Fires whenever a select / popover opens or closes, so the parent can
   *  keep the NodeToolbar pinned while a portaled dropdown is active. */
  readonly onAnyOpenChange?: (open: boolean) => void
}

/**
 * Hover-revealed toolbar below a Generate Text (`llm-chat`) node
 * (`topToolbarContent` slot). Exposes the four most-used controls inline —
 * AI Model, Template, # of runs, and the Run button — mirroring
 * GenerateImageQuickToolbar. Collapses to a single pill + popover when the
 * node is zoomed out / narrow.
 */
export function LlmChatQuickToolbar({
  nodeId,
  data,
  credits,
  isRunning,
  onAnyOpenChange,
}: LlmChatQuickToolbarProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const userTextTemplates = useWorkflowStore((s) => s.userTextTemplates)

  // Compact threshold: toolbar natural width vs visible node width (see
  // GenerateImageQuickToolbar for the rationale). Tuned for 3 ghost selects
  // + dot + run button.
  const TOOLBAR_NATURAL_WIDTH = 360
  const nodeWidth = useWorkflowStore((s) => {
    const n = s.nodes.find((nn) => nn.id === nodeId)
    const w = (n?.width as number | undefined) ?? (n?.measured?.width as number | undefined)
    return typeof w === "number" && w > 0 ? w : 260
  })
  const zoom = useStore((s) => s.transform[2])
  const visibleNodeWidth = nodeWidth * zoom
  const isCompact = TOOLBAR_NATURAL_WIDTH > visibleNodeWidth * 1.5

  const toolbarScale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  const toolbarTransform = {
    transform: `scale(${toolbarScale})`,
    transformOrigin: "50% 0%",
  } as const

  // Open-state tracking — report open while any select/popover is active so
  // the parent pins the NodeToolbar past the cursor leaving the node. Closes
  // deferred a macrotask so trigger-to-trigger handoff stays net positive.
  const [openCount, setOpenCount] = useState(0)
  const pendingCloseRef = useRef<number | null>(null)
  useEffect(() => {
    onAnyOpenChange?.(openCount > 0)
  }, [openCount, onAnyOpenChange])
  useEffect(
    () => () => {
      if (pendingCloseRef.current !== null) clearTimeout(pendingCloseRef.current)
    },
    [],
  )
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

  const currentModel = data.llmModel || LLM_FEATURE_DEFAULTS["llm-chat"]
  const modelEntry = useMemo(() => LLM_MODELS.find((m) => m.id === currentModel), [currentModel])
  const modelLabel = modelEntry?.displayName ?? currentModel

  const currentTemplateId = data.templateId ?? "custom"
  // Memoized to match the `modelEntry` precedent above — this toolbar is mounted
  // (and re-rendered) for every llm-chat node on the canvas, not only the hovered one.
  const templateLabel = useMemo(
    () => [...GENERATE_TEXT_TEMPLATES, ...userTextTemplates].find((t) => t.id === currentTemplateId)?.label ?? "Custom",
    [userTextTemplates, currentTemplateId],
  )

  // # of runs — clamp 1–4 in this UI (execution honors any value via
  // expandItemsWithRepeat; we narrow the toolbar to a sensible range).
  const repeatCount = Math.min(Math.max(1, (data.repeatCount as number | undefined) ?? 1), 4)

  const handleModelChange = (value: string) => updateNodeData(nodeId, { llmModel: value })
  const handleTemplateChange = (value: string) => updateNodeData(nodeId, { templateId: value })
  const handleRepeatChange = (value: string) => {
    const n = parseInt(value, 10)
    updateNodeData(nodeId, { repeatCount: Number.isFinite(n) ? n : 1 })
  }

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
    "node-menu-surface dark:border-white/10 dark:text-white"

  const modelItems = (
    <SelectContent className="node-menu-surface">
      {LLM_MODELS.map((m) => (
        <SelectItemWithMeta key={m.id} value={m.id} badge={TIER_LABELS[m.tier]} description={m.desc} className="text-xs">
          {m.displayName}
        </SelectItemWithMeta>
      ))}
    </SelectContent>
  )

  const templateItems = (
    <SelectContent className="node-menu-surface">
      <SelectGroup>
        <SelectLabel>Built-in</SelectLabel>
        {GENERATE_TEXT_TEMPLATES.map((t) => (
          <SelectItem key={t.id} value={t.id} className="text-xs">
            {t.label}
          </SelectItem>
        ))}
      </SelectGroup>
      {userTextTemplates.length > 0 && (
        <SelectGroup>
          <SelectLabel>My Presets</SelectLabel>
          {userTextTemplates.map((t) => (
            <SelectItem key={t.id} value={t.id} className="text-xs">
              {t.label || "Untitled"}
            </SelectItem>
          ))}
        </SelectGroup>
      )}
    </SelectContent>
  )

  const runsItems = (
    <SelectContent className="node-menu-surface">
      {[1, 2, 3, 4].map((n) => (
        <SelectItem key={n} value={String(n)} className="text-xs">
          × {n}
        </SelectItem>
      ))}
    </SelectContent>
  )

  // ── Compact mode (low zoom / narrow node) ──────────────────────────────
  if (isCompact) {
    return (
      <div className={`${containerClass} gap-1.5`} style={toolbarTransform} onClick={(e) => e.stopPropagation()}>
        <PromptEditButton nodeId={nodeId} compact />
        <Popover onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 h-6 px-2 text-[10px] rounded-md whitespace-nowrap text-neutral-900/85 hover:bg-black/10 dark:text-white/85 dark:hover:bg-white/10"
              title="Settings"
            >
              <Settings2 className="w-3 h-3 opacity-70" />
              <span className="font-medium">
                {modelLabel} · {templateLabel}
              </span>
              {repeatCount > 1 && <span className="font-medium opacity-80">× {repeatCount}</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" sideOffset={8} className="w-[240px] p-2 space-y-2 node-menu-surface" onClick={(e) => e.stopPropagation()}>
            <ToolbarSetting label="Model" icon={<Sparkles className="w-3 h-3" />}>
              <Select disabled={isRunning} value={currentModel} onValueChange={handleModelChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                {modelItems}
              </Select>
            </ToolbarSetting>
            <ToolbarSetting label="Preset" icon={<LayoutTemplate className="w-3 h-3" />}>
              <Select disabled={isRunning} value={currentTemplateId} onValueChange={handleTemplateChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                {templateItems}
              </Select>
            </ToolbarSetting>
            <ToolbarSetting label="Runs" icon={<Repeat2 className="w-3 h-3" />}>
              <Select disabled={isRunning} value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
                <SelectTrigger className={ghostPopoverTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                {runsItems}
              </Select>
            </ToolbarSetting>
          </PopoverContent>
        </Popover>
        <RunNodeButton nodeId={nodeId} credits={credits} isRunning={isRunning} onRun={(nid) => runSingleNode?.(nid)} />
      </div>
    )
  }

  // ── Default mode: ghost selects ────────────────────────────────────────
  return (
    <div className={`${containerClass} gap-0.5`} style={toolbarTransform} onClick={(e) => e.stopPropagation()}>
      <PromptEditButton nodeId={nodeId} />
      {/* AI Model */}
      <Select disabled={isRunning} value={currentModel} onValueChange={handleModelChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={`${ghostTriggerClass} max-w-[150px]`} title="AI model">
          <Sparkles className="opacity-70" />
          <SelectValue>{modelLabel}</SelectValue>
        </SelectTrigger>
        {modelItems}
      </Select>

      {/* Preset */}
      <Select disabled={isRunning} value={currentTemplateId} onValueChange={handleTemplateChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={`${ghostTriggerClass} max-w-[140px]`} title="Preset">
          <LayoutTemplate className="opacity-70" />
          <SelectValue>{templateLabel}</SelectValue>
        </SelectTrigger>
        {templateItems}
      </Select>

      {/* # of runs */}
      <Select disabled={isRunning} value={String(repeatCount)} onValueChange={handleRepeatChange} onOpenChange={handleOpenChange}>
        <SelectTrigger className={ghostTriggerClass} title="Number of runs">
          <Repeat2 className="opacity-70" />
          <SelectValue>× {repeatCount}</SelectValue>
        </SelectTrigger>
        {runsItems}
      </Select>


      {/* Run button — credit × repeat multiplier baked in by RunNodeButton. */}
      <RunNodeButton nodeId={nodeId} credits={credits} isRunning={isRunning} onRun={(nid) => runSingleNode?.(nid)} />
    </div>
  )
}


/** Row inside the compact popover: small icon + label, full-width select under it. */
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

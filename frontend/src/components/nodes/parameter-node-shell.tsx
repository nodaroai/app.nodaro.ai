"use client"

import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Eye, FileText, Layers as LayersIcon } from "lucide-react"
import { getParameterPromptHint } from "@nodaro/shared"
import { BaseNode, type HandleConfig } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useAutoMeasureForZoom } from "./use-auto-measure-for-zoom"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import {
  setStickyParameterDisplayMode,
  type ParameterDisplayMode as DisplayMode,
} from "@/lib/parameter-node-prefs"

interface ParameterNodeShellProps {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly handleId: string
  readonly selected?: boolean
  readonly children: ReactNode
  readonly fluidWidth?: boolean
  /** Override the default `in` target handle (e.g. camera-motion's startState + endState pair). */
  readonly inputHandles?: ReadonlyArray<HandleConfig>
  /** Floating HandleIcon labels rendered outside the node frame. */
  readonly extraHandleIcons?: ReactNode
}

const DEFAULT_INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-6px' }, hideHandle: true },
]

const makeHandles = (handleId: string, inputHandles?: ReadonlyArray<HandleConfig>): ReadonlyArray<HandleConfig> => [
  ...(inputHandles ?? DEFAULT_INPUT_HANDLES),
  { id: handleId, type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
]

export function ParameterNodeShell({ id, label, icon, handleId, selected, children, fluidWidth, inputHandles, extraHandleIcons }: ParameterNodeShellProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const handles = useMemo(() => makeHandles(handleId, inputHandles), [handleId, inputHandles])

  // Only show "Run from here" when this parameter node feeds at least one
  // downstream node — running with no consumers is a no-op for the user.
  const hasDownstream = useMemo(() => edges.some((e) => e.source === id), [edges, id])

  const node = useMemo(() => nodes.find((n) => n.id === id), [nodes, id])
  const data = (node?.data ?? {}) as Record<string, unknown>
  // Existing nodes keep whatever mode they were saved with; the localStorage
  // preference only seeds NEW nodes (handled in store `addNode`).
  const displayMode: DisplayMode = (data.displayMode as DisplayMode) || "picks"
  const setDisplayMode = (mode: DisplayMode) => {
    // Clear height to auto-fit the new mode's content. The
    // useAutoMeasureForZoom hook below handles the visual = logical
    // × zoom write-back when zoom != 1.
    updateNode(id, { height: undefined })
    updateNodeData(id, { displayMode: mode })
    // Remember the user's preference so the NEXT new parameter node spawns
    // in this mode. Existing nodes are unaffected — they keep their own
    // persisted displayMode.
    setStickyParameterDisplayMode(mode)
  }

  // Tell ReactFlow to re-measure this node whenever the display mode changes.
  // Switching between picks / prompt / both swaps content of very different
  // heights — without this, the node's reported size lags one render and
  // edges/handles can attach to stale positions.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, displayMode, updateNodeInternals])

  // When zoom != 1, React Flow's native auto-measure reads the wrapper's
  // CSS box at *logical* size — but visual = logical × zoom. The hook
  // measures the FULL outer wrapper (label + card + content) so the
  // write-back includes all chrome, not just the picks/prompt area.
  // Re-fires on displayMode OR zoom change OR Fit Content (anything that
  // sets visualHeight back to undefined).
  const wrapperRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const naturalContentRef = useRef<HTMLDivElement>(null)
  const visualHeight = node?.height
  useAutoMeasureForZoom({
    innerRef: wrapperRef,
    labelRef,
    zoom: ((data.zoom as number | undefined) ?? 1.0),
    visualHeight,
    onMeasured: (visualH) => updateNode(id, { height: visualH }),
    triggerKey: `${displayMode}|${(data.zoom as number | undefined) ?? 1.0}`,
  })

  // ResizeObserver on the natural content wrapper (no h-full) — when picks
  // are added/removed (changing the natural content HEIGHT), trigger a
  // re-fit by clearing node.height. The auto-measure hook then writes the
  // new visual height.
  //
  // Guard: only fire on pure HEIGHT changes. If width also changes, the
  // user is most likely manually resizing the node (text reflows produce
  // height changes too) — re-fitting then would jump the size mid-drag.
  // Track previous width and skip if it changed.
  const firedOnceRef = useRef(false)
  const prevWidthRef = useRef<number | null>(null)
  const prevHeightRef = useRef<number | null>(null)
  useEffect(() => {
    const el = naturalContentRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      const w = rect.width
      const h = rect.height
      if (!firedOnceRef.current) {
        firedOnceRef.current = true
        prevWidthRef.current = w
        prevHeightRef.current = h
        return
      }
      const widthChanged = prevWidthRef.current !== null && Math.abs(w - prevWidthRef.current) > 0.5
      const heightChanged = prevHeightRef.current !== null && Math.abs(h - prevHeightRef.current) > 0.5
      prevWidthRef.current = w
      prevHeightRef.current = h
      // Skip if width changed — user is resizing horizontally, height shifts
      // are reflow side-effects, not new picks. Also skip if height didn't
      // actually change.
      if (widthChanged || !heightChanged) return
      updateNode(id, { height: undefined })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [id, updateNode])

  // Compute the would-be prompt injection so users can preview what the
  // node contributes downstream. Pass the graph context so camera-motion
  // composes start/end edges; other types ignore ctx.
  const promptText = useMemo(() => {
    if (!node) return ""
    return getParameterPromptHint(node, { nodes, edges })
  }, [node, nodes, edges])

  return (
    <div ref={wrapperRef} className={cn("group", fluidWidth ? "relative w-full h-full" : "relative max-w-[220px]")}>
      <div ref={labelRef}>
        <EditableNodeLabel
          label={label}
          icon={icon}
          onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
        />
      </div>
      <BaseNode
        id={id}
        label={label}
        icon={icon}
        category="parameter"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={handles}
        topToolbarContent={
          hasDownstream ? (
            <RunNodeButton
              nodeId={id}
              credits={0}
              isRunning={false}
              onRun={(nid) => runFromHere?.(nid)}
              runFromHere
            />
          ) : undefined
        }
      >
        <div
          ref={contentRef}
          // Restored original conditional h-full for fluidWidth — this
          // is the pre-zoom behavior. Auto-measure uses wrapperRef
          // (parameter-node-shell's outermost div) which sizes to
          // natural content in the cleared-height state, so the
          // h-full-causes-growth issue doesn't apply.
          className={cn(fluidWidth ? "px-3 pt-0 pb-3 flex flex-col gap-2 h-full" : "px-3 pt-0 pb-3 flex flex-col gap-2")}
        >
          {/* Mode toggle (Picks / Prompt / Both) — pinned to top of body,
              zero padding above, zero margin below. Reserves its space via
              opacity (not display) so content placement stays stable when
              the toggle fades in/out. Hidden by default; visible on hover
              OR when the node is selected. */}
          <div
            // `relative top-[2px]` shifts the toggle visually down 2px
            // without taking extra layout space, so the picks/prompt
            // content below stays exactly where it was.
            className={cn(
              "nopan toggle-row relative top-[4px] flex justify-end mb-0 transition-opacity",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <DisplayModeToggle mode={displayMode} onChange={setDisplayMode} />
          </div>
          {/* Wrapper around the actual content children. ResizeObserver
              watches this (no h-full) so when picks add/remove changes
              the natural content size, we re-fit the node height. */}
          <div ref={naturalContentRef}>
            {(displayMode === "picks" || displayMode === "both") && children}
            {(displayMode === "prompt" || displayMode === "both") && (
              <div className={displayMode === "both" ? "mt-3" : ""}>
                <PromptPreview text={promptText} />
              </div>
            )}
          </div>
        </div>
      </BaseNode>

      <HandleIcon icon={icon} color="indigo" top="20px" />
      {extraHandleIcons}
    </div>
  )
}

function DisplayModeToggle({
  mode,
  onChange,
}: {
  readonly mode: DisplayMode
  readonly onChange: (mode: DisplayMode) => void
}) {
  return (
    <div
      className="nopan flex gap-0 rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-gray-50/95 dark:bg-[#161616]/95 backdrop-blur-sm overflow-hidden shadow-sm"
      role="tablist"
      aria-label="Display mode"
    >
      <ModeButton
        active={mode === "picks"}
        onClick={() => onChange("picks")}
        label="Picks"
        icon={<Eye className="size-3" />}
      />
      <ModeButton
        active={mode === "prompt"}
        onClick={() => onChange("prompt")}
        label="Prompt"
        icon={<FileText className="size-3" />}
      />
      <ModeButton
        active={mode === "both"}
        onClick={() => onChange("both")}
        label="Both"
        icon={<LayersIcon className="size-3" />}
      />
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly label: string
  readonly icon: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-[#ff0073]/15 text-[#ff0073]"
          : "text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-[#1a1a1a]",
      )}
      title={`Show ${label}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function PromptPreview({ text }: { readonly text: string }) {
  if (!text || !text.trim()) {
    return (
      <p className="text-muted-foreground text-[10.5px] italic leading-snug">
        (no prompt — pick something first)
      </p>
    )
  }
  return (
    <div className="rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#101010] px-2 py-1.5 max-w-full overflow-hidden">
      <p
        className="text-foreground text-[10.5px] leading-snug font-mono whitespace-pre-wrap"
        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
      >
        {text}
      </p>
    </div>
  )
}

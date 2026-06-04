"use client"

import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Eye, FileText, Layers as LayersIcon } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { getParameterPromptHint } from "@nodaro/shared"
import { BaseNode, type HandleConfig } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { HandleWithPopover } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { useAutoMeasureForZoom } from "./use-auto-measure-for-zoom"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import { getPickerOutputMeta } from "@/lib/picker-handles"
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
  { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-6px' }, hideHandle: true },
]

const makeHandles = (handleId: string, sourceIsExternal: boolean, inputHandles?: ReadonlyArray<HandleConfig>): ReadonlyArray<HandleConfig> => [
  ...(inputHandles ?? DEFAULT_INPUT_HANDLES),
  // external: when the node type is a registered picker, BaseNode counts the
  // entry for sizing but skips rendering — the pip is rendered by
  // <HandleWithPopover> below for typed-color + popover UX. For non-picker
  // fallback nodes (tone, provider, style-guide, duration, aspect-ratio,
  // scene-count, motion) the visible "icon" is a pointer-events-none
  // <HandleIcon> decoration, so we KEEP external:false to let BaseNode
  // render a real (hidden) <Handle> — otherwise drag-to-connect breaks.
  { id: handleId, type: "source", position: Position.Right, customStyle: { top: '24px', right: '-29px' }, hideHandle: true, external: sourceIsExternal },
]

export function ParameterNodeShell({ id, label, icon, handleId, selected, children, fluidWidth, inputHandles, extraHandleIcons }: ParameterNodeShellProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const openFullscreenSettings = useWorkflowStore((s) => s.openFullscreenSettings)

  // Narrow subscription: this node object + whether any downstream edge exists
  // + a primitive fingerprint of incoming connections (for camera-motion /
  // transition prompt-preview composition). `updateNodeData` preserves object
  // identity for unrelated nodes, so returning `node` via useShallow
  // short-circuits re-renders for mutations elsewhere on the graph — this
  // shell underpins all ~46 parameter pickers, so the whole-array subscription
  // was re-rendering every picker on a single keystroke anywhere.
  const { node, hasDownstream, incomingFingerprint } = useWorkflowStore(
    useShallow((s) => {
      const n = s.nodes.find((nn) => nn.id === id)
      let downstream = false
      // Only camera-motion / transition compose their prompt preview from
      // connected start/end states; for every other picker type the incoming
      // fingerprint is irrelevant, so skip the upstream walk entirely.
      const composes = n?.type === "camera-motion" || n?.type === "transition"
      let fp = ""
      for (const e of s.edges) {
        if (e.source === id) downstream = true
        if (composes && e.target === id) {
          const src = s.nodes.find((sn) => sn.id === e.source)
          // The connected start/end state can be ANY parameter picker, and
          // getParameterPromptHint reads different value fields per type — so
          // serialize the source's data wholesale (these are tiny parameter
          // nodes) to guarantee the prompt preview never goes stale.
          fp += `${e.id}\x01${e.targetHandle ?? ""}\x01${src?.type ?? ""}\x01${JSON.stringify(src?.data ?? {})}\x02`
        }
      }
      return { node: n, hasDownstream: downstream, incomingFingerprint: fp }
    }),
  )

  const data = (node?.data ?? {}) as Record<string, unknown>
  // Look up the source-handle visual for this picker's node type. Falls back
  // to the indigo HandleIcon if the type isn't registered (forward-compat for
  // legacy pickers).
  const pickerMeta = getPickerOutputMeta(node?.type ?? "")
  // When pickerMeta exists, the visible pip is owned by <HandleWithPopover>
  // below — BaseNode must NOT also render a <Handle> (external:true skips
  // it). When pickerMeta is null, the visible "icon" is a non-interactive
  // <HandleIcon> decoration, so BaseNode MUST render the real (hidden)
  // <Handle> to preserve drag-to-connect for the fallback path.
  const sourceIsExternal = pickerMeta !== null
  const handles = useMemo(
    () => makeHandles(handleId, sourceIsExternal, inputHandles),
    [handleId, sourceIsExternal, inputHandles],
  )
  // Existing nodes keep whatever mode they were saved with; the localStorage
  // preference only seeds NEW nodes (handled in store `addNode`).
  const displayMode: DisplayMode = (data.displayMode as DisplayMode) || "picks"
  const setDisplayMode = (mode: DisplayMode) => {
    // Clear height to auto-fit the new mode's content. Width is preserved:
    // the picks layout is ALWAYS in the DOM (visually hidden in prompt-only
    // mode) and the prompt preview uses `width: 0; min-width: 100%` so it
    // doesn't drive intrinsic width — meaning every mode renders at the
    // same picks-natural width. Toggling modes only changes vertical
    // content; horizontal stays put unless the user manually resizes.
    updateNode(id, { height: undefined })
    updateNodeData(id, { displayMode: mode })
    // Remember the user's preference so the NEXT new parameter node spawns
    // in this mode. Existing nodes are unaffected — they keep their own
    // persisted displayMode.
    setStickyParameterDisplayMode(mode)
  }

  // Tell ReactFlow to re-measure this node whenever the display mode OR
  // the source-handle ownership changes. Switching between picks / prompt
  // / both swaps content of very different heights, and the
  // sourceIsExternal flip (pickerMeta null↔non-null) swaps the source pip
  // between BaseNode-owned and HandleWithPopover-owned — both shifts can
  // leave edges/handles attached to stale positions without an explicit
  // re-measure.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, displayMode, sourceIsExternal, updateNodeInternals])

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
    // Only camera-motion / transition consult the graph context; for those the
    // memo re-runs (via the dep array) when `incomingFingerprint` changes. Read
    // live arrays at compute time so we don't hold a whole-array subscription.
    const { nodes, edges } = useWorkflowStore.getState()
    return getParameterPromptHint(node, { nodes, edges })
  }, [node, incomingFingerprint])

  return (
    <div ref={wrapperRef} className={cn("group", fluidWidth ? "relative w-full h-full" : "relative max-w-[220px]")}>
      <div ref={labelRef}>
        <EditableNodeLabel
          label={label}
          icon={icon}
          onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
          onIconClick={() => openFullscreenSettings(id)}
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
              the natural content size, we re-fit the node height.
              The picks layout is ALWAYS rendered so its intrinsic width
              drives the node — when in prompt-only mode it's visually
              hidden via max-h-0/overflow-hidden/invisible but still
              participates in width calculation, so toggling modes never
              changes the node's horizontal size. */}
          <div ref={naturalContentRef}>
            <div
              className={cn(
                displayMode === "prompt" &&
                  "max-h-0 overflow-hidden invisible pointer-events-none",
              )}
              aria-hidden={displayMode === "prompt" || undefined}
            >
              {children}
            </div>
            {(displayMode === "prompt" || displayMode === "both") && (
              // `width: 0; min-width: 100%` makes the prompt take the
              // parent's full width WITHOUT contributing to intrinsic
              // sizing — long single-line prompt text can no longer push
              // the node wider. The picks layout above is what defines
              // the natural width; the prompt wraps within it.
              <div
                className={displayMode === "both" ? "mt-3" : ""}
                style={{ width: 0, minWidth: "100%" }}
              >
                <PromptPreview text={promptText} />
              </div>
            )}
          </div>
        </div>
      </BaseNode>

      {/* Source pip rendering depends on whether the picker is registered
          (HandleWithPopover takes ownership of the real <Handle>) vs not
          (HandleIcon is a decoration; BaseNode renders the real <Handle>).
          During the brief window where React Flow has scheduled this
          component to render but the workflow store hasn't fully hydrated
          yet, `node` is undefined and `pickerMeta` is null.

          Rendering NOTHING during hydration is wrong: pre-PR the legacy
          indigo HandleIcon decoration was ALWAYS visible, so the node
          looked correct from first paint. Removing it caused a brief
          missing-pip flicker on every initial mount.

          Use HandleIcon as the hydration fallback — it's a
          `pointer-events-none` decoration only, so it can't conflict with
          any real <Handle>. BaseNode renders the real <Handle> during
          hydration because `sourceIsExternal` is false (it depends on
          pickerMeta, which is null until node is defined). Once
          hydrated, the branch swaps to either HandleWithPopover (for
          registered pickers — both the visible pip AND the real <Handle>)
          or HandleIcon again (for non-picker fallbacks — decoration plus
          BaseNode's real <Handle>). */}
      {node ? (pickerMeta ? (
        // The node component owns the glyph (via the `icon` prop) — we use
        // it for BOTH the label (in EditableNodeLabel above) AND the source
        // pip here. Previously the pip used `pickerMeta.icon` (Bot, Cloud,
        // Wind, etc.) which drifted from the per-node icon (PawPrint, Smile,
        // CloudFog) shown on the label, so node and pip looked semantically
        // unrelated. Single source of truth = the node component.
        <HandleWithPopover
          nodeId={id}
          handleId={handleId}
          nodeType={node.type ?? ""}
          type="source"
          position={Position.Right}
          label={pickerMeta.label}
          color={pickerMeta.color}
          icon={icon}
          side="right"
          top="24px"
        />
      ) : (
        <HandleIcon icon={icon} color="indigo" top="24px" />
      )) : (
        // Hydration fallback: match the legacy always-on indigo decoration.
        // Safe because HandleIcon is pointer-events-none — BaseNode owns
        // the real <Handle> while sourceIsExternal=false (no
        // duplicate-id warning possible).
        <HandleIcon icon={icon} color="indigo" top="24px" />
      )}
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

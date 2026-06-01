"use client"

import { Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { Handle, Position, useConnection, useStore } from "@xyflow/react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { useHandleConnections } from "@/hooks/use-handle-connections"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { getDragAncestorSet } from "@/lib/connection-validation"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"

// HandlePopover transitively pulls the parameter-picker registry (and ~30
// picker-preview components + ~30 catalogs) for in-node visuals on picker
// rows. None of that is needed for the always-rendered handle pip — it's
// only used inside the Radix PopoverContent which only mounts when the
// user clicks a pip. Lazy-loading keeps the editor's main bundle slim.
// Uses `lazyWithRetry` so a stale-chunk error after a production deploy
// auto-retries (and reloads once if needed) instead of bubbling to the
// route ErrorBoundary and crashing the editor.
//
// Defensive guard against a missing named export.
//
// In PROD: throw a chunk-error-shaped message so lazyWithRetry's retry +
// reload path engages. The intent is to recover from a stale-deploy
// scenario where the chunk loaded ok but the export-shape changed.
//
// In DEV: throw the REAL error so the developer sees an actionable stack
// trace. A fake chunk-error in dev would put a rename-bug into a
// reload-storm (RELOAD_KEY is cleared by main.tsx on every load, so the
// retry-reload cycle has no infinite-loop guard for this specific failure
// mode) which makes the bug nearly impossible to diagnose.
const HandlePopover = lazyWithRetry(() =>
  import("./handle-popover").then((m) => {
    if (!m.HandlePopover) {
      if (import.meta.env.PROD) {
        throw new Error("Failed to fetch dynamically imported module: HandlePopover export missing")
      }
      throw new Error("HandlePopover named export missing from ./handle-popover")
    }
    return { default: m.HandlePopover }
  }),
)

interface HandleWithPopoverProps {
  readonly nodeId: string
  readonly handleId: string
  /** The type of the node this handle belongs to (e.g. "generate-image"). Used
   *  by the add-node popup's connectionContext for type-aware filtering. */
  readonly nodeType: string
  readonly type: "source" | "target"
  readonly position: Position
  readonly label: string
  /** Hex color (e.g. `"#ff0073"`) for the pip's brand color. Applied to the
   *  ring + icon when connected; replaced by muted gray when unconnected. */
  readonly color: string
  /** Predicate that returns true when the given source node type is a valid
   *  upstream connection for THIS pip. Drives the per-pip "valid candidate"
   *  visual during a drag-to-connect: a connecting state with `accepts` set
   *  only lights up the pip when the in-progress drag's source matches.
   *  Omit to never light up as a candidate (the pip can still receive
   *  connections via direct hover — `.connectingto`). */
  readonly accepts?: (sourceNodeType: string) => boolean
  readonly icon: ReactNode
  /** "left" or "right" — which side of the node the pip is on. */
  readonly side: "left" | "right"
  /** CSS `top` value for vertical positioning relative to the node. */
  readonly top: string
  readonly orderMatters?: boolean
  /** True when this handle has a per-provider cap of 0 for the consumer's
   *  current model — meaning any edge wired to it would be silently dropped
   *  at runtime. Renders the pip with a muted ring + dim icon + dim label
   *  so users see at-a-glance which inputs are inactive for the chosen
   *  provider. Independent of `isConnected`; a disabled-but-connected pip
   *  shows both signals. */
  readonly disabled?: boolean
  /** When true, the pip's label stays visible at rest (not just on hover /
   *  selection). Used for ambiguous input pips like camera-motion's
   *  startState/endState pair where the two pips are otherwise visually
   *  identical without their labels. Source-direction (right-side) pips
   *  shouldn't need this — they're unambiguous one-per-node. */
  readonly alwaysShowLabel?: boolean
}

const CLICK_PX_THRESHOLD = 5
const CLICK_MS_THRESHOLD = 250

/** Ring color when the pip has no connections. Resolves via shadcn's
 *  `--border` CSS variable so it blends with the canvas background in both
 *  light (~#E2E8F0) and dark (~#2D2D2D) modes — the icon's brand color
 *  carries the type identification. */
const UNCONNECTED_COLOR = "var(--border)"

/** Re-exported so node files import the canonical color map + the handle
 *  component from one place: `import { HandleWithPopover, HANDLE_COLORS }`. */
export { HANDLE_COLORS }

/** Back-compat alias for the text/prompt color. Prefer `HANDLE_COLORS.text`
 *  in new code. */
export const TEXT_HANDLE_COLOR = HANDLE_COLORS.text

/**
 * A typed handle with built-in popover for managing connections.
 *
 * The React Flow `<Handle>` IS the visible pip — no wrapper div. Three
 * visual modes:
 *  - **Idle** (no connections, no drag): hollow ring in `var(--border)`,
 *    dimmed brand-color icon.
 *  - **Connecting** (drag-to-connect in progress; this pip is the source
 *    OR a valid target — driven by CSS state classes in globals.css):
 *    hollow ring in brand color, full-opacity brand-color icon.
 *  - **Connected** (≥1 edge wired): solid brand-color FILL, white icon,
 *    counter badge with the connection count.
 *
 * Click → opens popover. Drag → React Flow's drag-to-connect proceeds.
 *
 * Node-agnostic: works for any node by passing nodeId + handleId.
 */
export function HandleWithPopover({
  nodeId,
  handleId,
  nodeType,
  type,
  position,
  label,
  color,
  accepts,
  icon,
  side,
  top,
  orderMatters,
  disabled = false,
  alwaysShowLabel,
}: HandleWithPopoverProps) {
  const [open, setOpen] = useState(false)
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const connections = useHandleConnections(nodeId, handleId, type === "target" ? "target" : "source")
  const openPopup = useWorkflowStore((s) => s.openAddNodePopupForHandle)
  const isConnected = connections.length > 0
  // Floor the visual scale of the pip-side label when the canvas is zoomed
  // out — compensates RF's `visual = DOM × zoom` by applying a counter
  // `scale(MIN/zoom)` once we drop below the floor. Keeps the label
  // readable without making it dominant at zoom-in (`scale = 1` then).
  const zoom = useStore((s) => s.transform[2])
  const labelCompensateScale = Math.max(1, NODE_VISUAL_SCALE_FLOOR / Math.max(zoom, 0.01))

  // Per-pip compatibility check for the in-progress drag. The pip lights up
  // as a valid candidate when ALL of these are true:
  //  - there's a drag in progress
  //  - this pip is the right direction (target during from-source drag and
  //    vice versa)
  //  - the drag didn't start from this pip itself
  //  - the drag didn't start from this pip's node (no self-loops — the
  //    workflow engine is a DAG and can't execute a node before itself)
  //  - this pip's node isn't already an ancestor of the drag source
  //    (no back-edges — same DAG reason; check is direction-aware)
  //  - the per-direction accepts predicate returns true:
  //    - target pip: this pip's own `accepts(sourceType)` (target-direction)
  //    - source pip: the drag-target's TARGET_HANDLE_ACCEPTS entry accepts
  //      THIS picker's nodeType (source-direction reverse lookup)
  // Drives the `.valid-candidate` class.
  const connection = useConnection()
  // Subscribe to edges so the cycle/ancestor check sees current state.
  // Edges change rarely (only on actual edge add/remove), so the cost of
  // an extra store subscription per pip is negligible relative to the
  // correctness it buys. `getDragAncestorSet` caches the resulting set
  // module-side, keyed on the edges ref + drag source — so the BFS only
  // runs once per drag start regardless of how many pips are visible.
  const edges = useWorkflowStore((s) => s.edges)
  const isValidCandidate = useMemo(() => {
    if (!connection.inProgress) return false
    const from = connection.fromHandle
    const fromType = connection.fromNode?.type
    if (!from || !fromType) return false
    // Skip the pip the drag started from — it already lights up via .connectingfrom.
    if (from.nodeId === nodeId && from.id === handleId) return false
    // Self-loop: same node, any handle. The workflow engine is a DAG;
    // a node cannot execute before itself.
    if (from.nodeId === nodeId) return false
    // Target-direction branch: drag started from a source pip; light this
    // target pip if our own accepts predicate accepts the drag's source type,
    // AND the resulting edge wouldn't close a directed cycle.
    if (type === "target" && from.type === "source") {
      if (!accepts || !accepts(fromType)) return false
      // Cycle check: would-be edge is (from.nodeId → nodeId). Cycle iff
      // nodeId is already an ancestor of from.nodeId.
      const ancestors = getDragAncestorSet(edges, from.nodeId)
      if (ancestors.has(nodeId)) return false
      return true
    }
    // Source-direction branch: drag started from a target pip; light this
    // source pip if THAT target's accepts predicate accepts this picker's
    // node type, AND the resulting edge wouldn't close a directed cycle.
    if (type === "source" && from.type === "target") {
      const entries = TARGET_HANDLE_ACCEPTS[fromType] ?? []
      const entry = entries.find((e) => e.handleId === from.id)
      if (!entry?.accepts(nodeType)) return false
      // Would-be edge is (nodeId → from.nodeId). Cycle iff from.nodeId is
      // already an ancestor of nodeId.
      const ancestors = getDragAncestorSet(edges, nodeId)
      if (ancestors.has(from.nodeId)) return false
      return true
    }
    return false
  }, [connection.inProgress, connection.fromHandle, connection.fromNode?.type, accepts, nodeId, handleId, type, nodeType, edges])

  // Highlight every type-compatible destination during a drag, regardless
  // of whether it already has connections. The user wants to see ALL
  // possible drop targets — the existing-wires signal comes from the
  // connection counter badge (revealed on hover/selection), not from
  // suppressing the candidate visual.
  const showValidCandidateVisual = isValidCandidate

  const handleAddNew = useCallback(() => {
    openPopup?.({ nodeId, handleId, direction: type === "target" ? "target" : "source", nodeType })
  }, [openPopup, nodeId, handleId, type, nodeType])

  // Stable identity so HandlePopover's `handleJump` useCallback deps don't
  // bust on every parent render (which would in turn churn every row's
  // onJump prop and defeat any future React.memo on rows).
  const onClose = useCallback(() => setOpen(false), [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }, [])

  const cancelDown = useCallback(() => {
    downRef.current = null
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = downRef.current
    downRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dt = Date.now() - start.t
    if (dx * dx + dy * dy < CLICK_PX_THRESHOLD * CLICK_PX_THRESHOLD && dt < CLICK_MS_THRESHOLD) {
      e.stopPropagation()
      e.preventDefault()
      setOpen(true)
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setOpen((v) => !v)
    }
    // Backspace / Delete defense: React Flow's useKeyPress attaches its
    // keydown listener directly to `document` via native addEventListener
    // (see @xyflow/react/dist/esm/index.js useKeyPress), so React's
    // synthetic `e.stopPropagation()` does NOT reach it. The pip wears the
    // `nokey` class below, which @xyflow/system's `isInputDOMNode` checks
    // via `target.closest('.nokey')` to opt out — that's the primary
    // defense. We keep both stopPropagation AND stopImmediatePropagation
    // as belt-and-suspenders in case a third-party listener attaches at a
    // higher capture phase.
    if (e.key === "Backspace" || e.key === "Delete") {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Handle
          id={handleId}
          type={type}
          position={position}
          isConnectable
          onPointerDownCapture={onPointerDown}
          onPointerUpCapture={onPointerUp}
          onPointerCancel={cancelDown}
          onPointerLeave={cancelDown}
          onKeyDown={onKeyDown}
          // A11y: pips are tab-stoppable AND announce as buttons that open
          // a dialog (the popover). The trade-off: a node with 6-7 typed
          // pips adds that many tab stops, but the alternative — tabIndex
          // -1 + role="img" — left keyboard-only users with no way to
          // discover or operate the popover at all. The popover's
          // Connect/Disconnect/Focus buttons remain reachable from
          // inside Radix as before; this just gives the pip itself a way
          // in via Tab → Enter/Space.
          tabIndex={0}
          role="button"
          aria-haspopup="dialog"
          aria-label={`${label}${isConnected ? ` (${connections.length} connected)` : ""}${disabled ? " (not used by current model)" : ""}`}
          title={disabled ? "Not used by the current model — any wired edge will be ignored at runtime." : undefined}
          // `touch-manipulation` disables double-tap zoom delay on iOS so
          // the click→popover-open feels instant on touch devices.
          // `nokey` opts out of React Flow's global keyboard shortcuts
          // (Backspace/Delete delete the node, Cmd+A select all, etc.)
          // when the pip is focused — @xyflow/system's `isInputDOMNode`
          // returns true for any element matched by `.closest('.nokey')`,
          // and React Flow's useKeyPress short-circuits in that case.
          // `clickconnecting` is added while the popover is open so CSS
          // can light the pip in brand color (mirrors React Flow's
          // built-in `.connectingfrom` state during drags).
          className={`handle-typed-pip nokey !w-7 !h-7 !rounded-full !border-2 flex items-center justify-center cursor-pointer touch-manipulation ${isConnected ? "shadow-lg" : ""} ${showValidCandidateVisual ? "valid-candidate" : ""} ${open ? "clickconnecting" : ""}`}
          style={{
            top,
            [side]: "-29px",
            transform: "translateY(-50%)",
            zIndex: 1002,
            opacity: disabled ? 0.45 : 1,
            // `--pip-color` is read by CSS rules in globals.css to light up
            // the ring in brand color during a drag-to-connect (the
            // `.handle-typed-pip.connectingfrom` block + variants). When
            // disabled, the color is replaced by the muted border var so a
            // valid-candidate flash during a drag still pulses *muted* —
            // visually signaling "you can drop here but it won't be used."
            ["--pip-color" as unknown as string]: disabled ? UNCONNECTED_COLOR : color,
            borderColor: disabled ? UNCONNECTED_COLOR : isConnected ? color : UNCONNECTED_COLOR,
            background: disabled ? "var(--background)" : isConnected ? color : "var(--background)",
            borderStyle: "solid",
          }}
        >
          <span
            // Connected → white icon over the solid color fill.
            // Idle → brand-color icon dimmed to 35%; CSS bumps it to 100%
            //   during a drag-to-connect so valid candidates light up.
            // Disabled → muted-foreground icon at 50%, regardless of
            //   connected state — overrides brand color so the inactive
            //   signal is unmistakable.
            className="pointer-events-none [&>svg]:w-3.5 [&>svg]:h-3.5 flex items-center justify-center handle-typed-pip-icon"
            style={{
              color: disabled ? "var(--muted-foreground)" : isConnected ? "white" : color,
              opacity: disabled ? 0.5 : isConnected ? 1 : 0.35,
            }}
          >
            {icon}
          </span>
          {connections.length > 1 && (
            <span
              // Badge sits at the pip's outer edge with ~1/4 of itself
              // overlapping the pip (offset -10 from the pip's outer edge).
              // Hidden by default; revealed on node hover or when the node
              // is selected via the `.handle-typed-pip-badge` CSS rules.
              className="handle-typed-pip-badge absolute text-[9px] font-bold leading-none tabular-nums rounded-full flex items-center justify-center pointer-events-none bg-white text-neutral-900 border border-background shadow-sm"
              style={{
                width: 14,
                height: 14,
                top: "50%",
                [side]: -10,
                transform: "translateY(-50%)",
              }}
            >
              {connections.length}
            </span>
          )}
          <span
            // Type label rendered outside the pip. Offset 14px keeps the
            // label close to the node while still sitting just past the
            // counter badge's outermost point (~10px out), so the label
            // position is consistent whether the badge is visible or not.
            // Hidden by default — see `.handle-typed-pip-label` CSS rules.
            // `--always` modifier keeps the label visible at rest (used for
            // ambiguous input pips like camera-motion's startState/endState
            // which look identical without their labels).
            className={`handle-typed-pip-label absolute text-[12px] font-medium whitespace-nowrap pointer-events-none text-muted-foreground${alwaysShowLabel ? " handle-typed-pip-label--always" : ""}`}
            style={{
              top: "50%",
              [side === "left" ? "right" : "left"]: "calc(100% + 14px)",
              transform: `translateY(-50%) scale(${labelCompensateScale})`,
              transformOrigin: side === "left" ? "100% 50%" : "0% 50%",
              // Disabled pip's label dims further so the row reads as
              // inactive at a glance — the icon's muted-foreground color
              // already carries the signal but the label is the lingering
              // wordy bit on hover.
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {label}
          </span>
        </Handle>
      </PopoverAnchor>
      <PopoverContent
        side={side === "left" ? "left" : "right"}
        align="start"
        sideOffset={12}
        className="w-auto p-2 node-menu-surface"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Skeleton fallback gives Radix Floating UI a stable WIDTH anchor
         *  on first cold open so the popover doesn't paint at ~0×0 and
         *  collision-pad against the viewport. Vertical size is left to
         *  the spinner (`py-4` = ~48px) so the skeleton tracks the typical
         *  sparse popover (~60-80px content) without OVERSHOOTING — a
         *  fixed `min-h` taller than the typical content would cause a
         *  post-paint SHRINK that Radix may respond to with a side-flip,
         *  which is the exact jump we're trying to prevent.
         *
         *  Accessibility: `role="status"` implies `aria-live="polite"`,
         *  so we don't repeat it. The visible "Loading…" text drives the
         *  accessible name (no `aria-label` shadowing). */}
        <Suspense
          fallback={
            <div
              role="status"
              className="min-w-[280px] flex items-center justify-center py-4"
            >
              <span className="text-[10px] text-muted-foreground/60">Loading…</span>
            </div>
          }
        >
          <HandlePopover
            nodeId={nodeId}
            handleId={handleId}
            direction={type === "target" ? "target" : "source"}
            label={label}
            orderMatters={orderMatters}
            accepts={accepts}
            onAddNew={openPopup ? handleAddNew : undefined}
            onClose={onClose}
            color={disabled ? undefined : color}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}

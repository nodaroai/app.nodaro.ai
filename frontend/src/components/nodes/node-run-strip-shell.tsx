"use client"

import { type ReactNode } from "react"
import { useStore } from "@xyflow/react"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"

/**
 * The canonical bottom "run strip" pill — the single source of truth for how
 * EVERY node's run affordance is framed. {@link BaseNode} wraps whatever a node
 * passes as `topToolbarContent` (a bare {@link RunNodeButton}, or the
 * {@link NodeQuickStrip} configs+Run row) in this shell, so the container
 * styling and zoom-scaling are identical across all ~150 node types and a new
 * node gets them for free.
 *
 * Zoom-scaling: the strip compensates React Flow's canvas zoom so its visual
 * size never drops below `NODE_VISUAL_SCALE_FLOOR × natural` when zoomed out,
 * and tracks the node's own growth 1:1 when zoomed in (mirrors the floating
 * title, typed-handle labels, and the bespoke quick toolbars — see
 * {@link NODE_VISUAL_SCALE_FLOOR}). React Flow's `NodeToolbar` only *translates*
 * its portal (never scales it), so without this the run button would stay a
 * fixed screen size while the node around it grows/shrinks.
 *
 * Mounted only while the toolbar is visible (NodeToolbar returns null when
 * inactive), so the `useStore` zoom subscription is live for just the
 * hovered/running node — no canvas-wide re-render on pan/zoom.
 *
 * Bespoke toolbars (generate-image/video, llm-chat, video-retake, video-sfx)
 * manage their own pill + compact mode, so their host nodes pass them via
 * BaseNode's `rawToolbarContent` to bypass this shell (no double-wrap).
 */
export function NodeRunStripShell({
  children,
  footnote,
}: {
  readonly children: ReactNode
  /** A line under the pill (e.g. the Settings input's price note); the pair scales as one. */
  readonly footnote?: ReactNode
}) {
  const zoom = useStore((s) => s.transform[2])
  const scale = Math.max(NODE_VISUAL_SCALE_FLOOR, zoom)
  const transform = { transform: `scale(${scale})`, transformOrigin: "50% 0%" } as const
  const pill = (
    <div
      data-testid="node-run-strip"
      className="flex items-center gap-0.5 px-1.5 py-1 backdrop-blur-sm rounded-xl border node-menu-surface"
      style={footnote ? undefined : transform}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
  if (!footnote) return pill
  return (
    <div className="flex flex-col items-center" style={transform}>
      {pill}
      {footnote}
    </div>
  )
}

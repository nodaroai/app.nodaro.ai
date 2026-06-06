import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { useStore } from "@xyflow/react"
import { MoreHorizontal } from "lucide-react"
import { PresetDropdown } from "@/components/editor/config-panels/node-preset-dropdown"

/**
 * Content of a node's top hover toolbar (preset dropdown + 3-dots + per-node actions).
 *
 * React Flow's `NodeToolbar` positions its content but renders it at a CONSTANT screen size — it
 * does NOT scale with the canvas (viewport) zoom (its transform is translate-only). The node title,
 * by contrast, scales with both the canvas zoom and the per-node zoom. So to keep the toolbar text
 * the same size as the node title, we scale our content by `canvasZoom × nodeZoom`.
 *
 * `canvasZoom` is read here (not in BaseNode) on purpose: this component only mounts while the
 * toolbar is visible (NodeToolbar returns null when hidden), so the viewport-zoom subscription is
 * active for at most the one hovered node — no per-node re-render storm during zoom.
 */
export function NodeTopToolbar({
  nodeId,
  nodeZoom,
  onMoreMenu,
  toolbarActions,
  onEnter,
  onLeave,
  onPresetOpenChange,
}: {
  readonly nodeId: string
  /** Per-node zoom (`data.zoom`, default 1). */
  readonly nodeZoom: number
  readonly onMoreMenu: (e: ReactMouseEvent) => void
  readonly toolbarActions?: ReactNode
  readonly onEnter: () => void
  readonly onLeave: () => void
  readonly onPresetOpenChange: (open: boolean) => void
}) {
  const canvasZoom = useStore((s) => s.transform[2])
  const scale = canvasZoom * nodeZoom
  return (
    <div className="flex items-center gap-1" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <PresetDropdown nodeId={nodeId} variant="node" zoom={scale} onOpenChange={onPresetOpenChange} />
      <button
        className="node-more-menu-btn text-muted-foreground transition-colors"
        onClick={onMoreMenu}
        aria-label="More options"
      >
        <MoreHorizontal size={Math.round(scale * 13)} />
      </button>
      {toolbarActions}
    </div>
  )
}

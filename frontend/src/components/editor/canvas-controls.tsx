"use client"

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Maximize2, ZoomIn, ZoomOut, Map, Magnet, Ruler, Crosshair } from "lucide-react"
import { useReactFlow, useStoreApi } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { findNodeNearestToPoint } from "@/lib/canvas-navigation"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatZoomPercent, snapZoom, scrubZoom, parseZoomInput } from "@/lib/zoom"
import { SHORTCUTS, formatBinding, isMacPlatform } from "@/lib/shortcuts"

interface CanvasControlsProps {
  /** Live canvas zoom factor (React Flow transform[2]); 1 = 100%. */
  readonly zoom: number
  readonly showMiniMap: boolean
  readonly onToggleMiniMap: () => void
  readonly snapEnabled: boolean
  readonly onToggleSnap: () => void
  readonly alignmentEnabled: boolean
  readonly onToggleAlignment: () => void
  readonly isMobile?: boolean
}

interface ControlButtonProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly active?: boolean
}

function ControlButton({ icon, label, onClick, active }: ControlButtonProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200",
              // Light mode
              "text-[#64748B]",
              "hover:bg-[#F1F5F9] hover:text-[#0F172A]",
              // Dark mode
              "dark:text-[#94A3B8]",
              "dark:hover:bg-[#2D2D2D] dark:hover:text-white",
              // Active state
              active && "bg-[#ff0073]/10 text-[#ff0073] dark:bg-[#ff0073]/20 dark:text-[#ff0073]"
            )}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className={cn(
            "rounded-lg px-3 py-2 shadow-sm",
            // Light mode
            "bg-white text-[#1E293B] border border-[#E2E8F0]",
            // Dark mode
            "dark:bg-[#2D2D2D] dark:text-[#E2E8F0] dark:border-[#3D3D3D] dark:shadow-xl"
          )}
        >
          <span className="text-sm">{label}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const DRAG_THRESHOLD_PX = 3
const DOUBLE_TAP_MS = 220
const DOUBLE_TAP_DIST_PX = 5

/**
 * Live zoom read-out + multi-gesture control:
 *  - single click → inline number editor (type a %)
 *  - double click → reset to 100% (via onReset)
 *  - press + drag vertically → scrub the zoom (up = in, down = out)
 *
 * Pointer-based so a scrub keeps tracking outside the small button (capture).
 * Edit vs reset are disambiguated by a short tap window, mirroring CustomHandle.
 */
function ZoomControl({
  zoom,
  onSetZoom,
  onReset,
}: {
  readonly zoom: number
  readonly onSetZoom: (zoom: number, opts?: { animate?: boolean }) => void
  readonly onReset: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const dragRef = useRef<{ startY: number; startZoom: number; moved: boolean } | null>(null)
  const consumedRef = useRef(false)
  const tapRef = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const finishedRef = useRef(false)
  const label = formatZoomPercent(zoom)

  function clearTap() {
    if (tapRef.current) {
      clearTimeout(tapRef.current.timer)
      tapRef.current = null
    }
  }

  function beginEdit() {
    finishedRef.current = false
    setDraft(String(Math.round(zoom * 1000) / 10))
    setEditing(true)
  }

  function finish(apply: boolean) {
    if (finishedRef.current) return
    finishedRef.current = true
    if (apply) {
      const z = parseZoomInput(draft)
      if (z != null) onSetZoom(z, { animate: true })
    }
    setEditing(false)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (editing) return
    e.stopPropagation()
    // Second tap within the window + close by → reset to 100% (no scrub/edit).
    if (
      tapRef.current &&
      Math.abs(e.clientX - tapRef.current.x) < DOUBLE_TAP_DIST_PX &&
      Math.abs(e.clientY - tapRef.current.y) < DOUBLE_TAP_DIST_PX
    ) {
      clearTap()
      consumedRef.current = true
      onReset()
      return
    }
    consumedRef.current = false
    dragRef.current = { startY: e.clientY, startZoom: zoom, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* jsdom / unsupported */
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = dragRef.current
    if (!d || consumedRef.current) return
    const dy = d.startY - e.clientY // up = positive = zoom in
    if (!d.moved && Math.abs(dy) <= DRAG_THRESHOLD_PX) return
    d.moved = true
    onSetZoom(scrubZoom(d.startZoom, dy))
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* jsdom / unsupported */
    }
    const d = dragRef.current
    dragRef.current = null
    if (consumedRef.current) {
      consumedRef.current = false
      return // was a double-tap reset
    }
    if (!d || d.moved) return // a scrub just finished (or no drag)
    // A clean tap — wait briefly to see if a second tap (double) follows; if not,
    // open the editor.
    const x = e.clientX
    const y = e.clientY
    tapRef.current = {
      x,
      y,
      timer: setTimeout(() => {
        tapRef.current = null
        beginEdit()
      }, DOUBLE_TAP_MS),
    }
  }

  if (editing) {
    return (
      <input
        type="text"
        inputMode="decimal"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            finish(true)
          } else if (e.key === "Escape") {
            e.preventDefault()
            finish(false)
          }
        }}
        aria-label="Set zoom percentage"
        className={cn(
          "h-9 w-[3.5rem] px-2 text-center text-sm font-medium tabular-nums rounded-lg",
          "bg-transparent outline-none ring-1 ring-[#ff0073]",
          "text-[#0F172A] dark:text-white",
        )}
      />
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="zoom-value"
            aria-label={`Zoom ${label}. Click to type a value, double-click to reset to 100%, drag to zoom.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn(
              "h-9 min-w-[3.5rem] px-2 flex items-center justify-center rounded-lg select-none touch-none cursor-ns-resize",
              "text-sm font-medium tabular-nums transition-all duration-200",
              "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]",
              "dark:text-[#94A3B8] dark:hover:bg-[#2D2D2D] dark:hover:text-white",
            )}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          className={cn(
            "rounded-lg px-3 py-2 shadow-sm",
            "bg-white text-[#1E293B] border border-[#E2E8F0]",
            "dark:bg-[#2D2D2D] dark:text-[#E2E8F0] dark:border-[#3D3D3D] dark:shadow-xl"
          )}
        >
          <span className="text-sm">Click to type · double-click 100% · drag to zoom</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { ZoomControl }

export function CanvasControls({ zoom, showMiniMap, onToggleMiniMap, snapEnabled, onToggleSnap, alignmentEnabled, onToggleAlignment, isMobile }: CanvasControlsProps) {
  const { fitView, zoomTo, getNodes, setCenter } = useReactFlow()
  const storeApi = useStoreApi()
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isMac = isMacPlatform()

  // Center the canvas on the node nearest the current screen center (keeping the
  // current zoom) and select it so it highlights. Pane size + transform are read
  // imperatively so the control bar doesn't re-render on every pan.
  const handleAutoFocus = useCallback(() => {
    const { width, height, transform } = storeApi.getState()
    const [tx, ty, z] = transform
    const center = { x: (width / 2 - tx) / z, y: (height / 2 - ty) / z }
    const nodes = getNodes()
    const nearestId = findNodeNearestToPoint(nodes, center)
    if (!nearestId) return
    const target = nodes.find((n) => n.id === nearestId)
    if (!target) return
    const w = target.measured?.width ?? 200
    const h = target.measured?.height ?? 100
    setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: z, duration: 400 })
    selectNode(nearestId)
  }, [storeApi, getNodes, setCenter, selectNode])

  return (
    <div
      className={cn(
        "absolute bottom-4 left-4 z-10",
        "flex items-center gap-1 p-1",
        "rounded-xl backdrop-blur-md",
        "transition-all duration-300 ease-in-out",
        // Light mode
        "bg-white/80 border border-[#E2E8F0] shadow-sm",
        // Dark mode
        "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-xl",
      )}
    >
      <ControlButton
        icon={<Maximize2 className="w-4 h-4" />}
        label="Fit to Screen"
        onClick={() => fitView({ padding: 0.2 })}
      />
      <ControlButton
        icon={<Crosshair className="w-4 h-4" />}
        label="Focus nearest node"
        onClick={handleAutoFocus}
      />
      {/* Familiar  −  100%  +  cluster. +/− snap to the zoom ladder; the % reads
          the live zoom and is itself an editor/scrubber/reset (see ZoomControl). */}
      <ControlButton
        icon={<ZoomOut className="w-4 h-4" />}
        label="Zoom Out"
        onClick={() => zoomTo(snapZoom(zoom, -1), { duration: 200 })}
      />
      <ZoomControl
        zoom={zoom}
        onSetZoom={(z, opts) => zoomTo(z, { duration: opts?.animate ? 200 : 0 })}
        onReset={() => zoomTo(1, { duration: 200 })}
      />
      <ControlButton
        icon={<ZoomIn className="w-4 h-4" />}
        label="Zoom In"
        onClick={() => zoomTo(snapZoom(zoom, 1), { duration: 200 })}
      />
      {!isMobile && (
        <>
          <div className="w-px h-5 bg-[#E2E8F0] dark:bg-[#2D2D2D] mx-0.5" />
          <ControlButton
            icon={<Map className="w-4 h-4" />}
            label="Toggle MiniMap"
            onClick={onToggleMiniMap}
            active={showMiniMap}
          />
          <ControlButton
            icon={<Magnet className="w-4 h-4" />}
            label={`Snap to Grid (${formatBinding(SHORTCUTS.gridSnap.bindings[0], isMac)})`}
            onClick={onToggleSnap}
            active={snapEnabled}
          />
          <ControlButton
            icon={<Ruler className="w-4 h-4" />}
            label={`Alignment Guides (${formatBinding(SHORTCUTS.alignmentGuides.bindings[0], isMac)})`}
            onClick={onToggleAlignment}
            active={alignmentEnabled}
          />
        </>
      )}
    </div>
  )
}

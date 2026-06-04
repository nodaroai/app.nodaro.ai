"use client"

import { Maximize2, ZoomIn, ZoomOut, Map, Magnet, Ruler } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Format a React Flow zoom factor as a display percentage: ×100, rounded to a
 * single decimal, with a trailing ".0" dropped. e.g. 1 → "100%", 0.882 →
 * "88.2%", 0.75 → "75%", 1.8 → "180%".
 */
export function formatZoomPercent(zoom: number): string {
  const pct = Math.round(zoom * 1000) / 10
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`
}

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

/** Live zoom read-out that doubles as a "reset to 100%" button. Text variant of
 *  ControlButton — fixed min-width so the pill doesn't jitter as digits change. */
function ZoomResetButton({ zoom, onReset }: { readonly zoom: number; readonly onReset: () => void }) {
  const label = formatZoomPercent(zoom)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Zoom ${label}, click to reset to 100%`}
            onClick={onReset}
            className={cn(
              "h-9 min-w-[3.5rem] px-2 flex items-center justify-center rounded-lg",
              "text-sm font-medium tabular-nums transition-all duration-200",
              // Light mode
              "text-[#64748B]",
              "hover:bg-[#F1F5F9] hover:text-[#0F172A]",
              // Dark mode
              "dark:text-[#94A3B8]",
              "dark:hover:bg-[#2D2D2D] dark:hover:text-white",
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
          <span className="text-sm">Reset to 100%</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CanvasControls({ zoom, showMiniMap, onToggleMiniMap, snapEnabled, onToggleSnap, alignmentEnabled, onToggleAlignment, isMobile }: CanvasControlsProps) {
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow()

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
      {/* Familiar  −  100%  +  cluster. The % reads the live zoom and resets to
          100% on click. */}
      <ControlButton
        icon={<ZoomOut className="w-4 h-4" />}
        label="Zoom Out"
        onClick={() => zoomOut()}
      />
      <ZoomResetButton zoom={zoom} onReset={() => zoomTo(1, { duration: 200 })} />
      <ControlButton
        icon={<ZoomIn className="w-4 h-4" />}
        label="Zoom In"
        onClick={() => zoomIn()}
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
            label="Snap to Grid (Ctrl+Shift+G)"
            onClick={onToggleSnap}
            active={snapEnabled}
          />
          <ControlButton
            icon={<Ruler className="w-4 h-4" />}
            label="Alignment Guides (Ctrl+Shift+A)"
            onClick={onToggleAlignment}
            active={alignmentEnabled}
          />
        </>
      )}
    </div>
  )
}

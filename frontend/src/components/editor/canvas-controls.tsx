"use client"

import { Maximize2, ZoomIn, ZoomOut, Map } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface CanvasControlsProps {
  readonly showMiniMap: boolean
  readonly onToggleMiniMap: () => void
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

export function CanvasControls({ showMiniMap, onToggleMiniMap }: CanvasControlsProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  return (
    <div
      className={cn(
        "absolute bottom-4 left-16 z-10",
        "flex items-center gap-1 p-1",
        "rounded-xl backdrop-blur-md",
        // Light mode
        "bg-white/80 border border-[#E2E8F0] shadow-sm",
        // Dark mode
        "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-xl"
      )}
    >
      <ControlButton
        icon={<Maximize2 className="w-4 h-4" />}
        label="Fit to Screen"
        onClick={() => fitView({ padding: 0.2 })}
      />
      <ControlButton
        icon={<ZoomIn className="w-4 h-4" />}
        label="Zoom In"
        onClick={() => zoomIn()}
      />
      <ControlButton
        icon={<ZoomOut className="w-4 h-4" />}
        label="Zoom Out"
        onClick={() => zoomOut()}
      />
      <div className="w-px h-5 bg-[#E2E8F0] dark:bg-[#2D2D2D] mx-0.5" />
      <ControlButton
        icon={<Map className="w-4 h-4" />}
        label="Toggle MiniMap"
        onClick={onToggleMiniMap}
        active={showMiniMap}
      />
    </div>
  )
}

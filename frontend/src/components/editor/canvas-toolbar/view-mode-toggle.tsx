import { Film, LayoutDashboard, ScrollText, Square } from "lucide-react"
import { useSceneViewModeStore } from "@/lib/scene-view-mode-store"
import type { SceneViewMode } from "@/components/nodes/scene-views/view-mode-registry"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Phase 1C.2 — Canvas-wide Scene View Modes toggle (spec §6.9.4, formerly
 * "Director Working Modes" in §11.4). Lives in the floating canvas toolbar
 * group; flips every SceneNode on the canvas between four view modes:
 *
 *   - default     — minimal card (label + intent badge)
 *   - storyboard  — keyframe grid; the most common mode
 *   - video       — composite_video_url player
 *   - scripting   — dialogue + action lines + script-formatted shot list
 *
 * Clicking a button sets the canvas-wide override; clicking the active
 * button clears it (returns to per-node selection). The store is UI-only
 * and not persisted to the workflow document.
 */

interface ModeButtonDef {
  readonly mode: SceneViewMode
  readonly label: string
  readonly description: string
  readonly Icon: React.ComponentType<{ className?: string }>
}

const MODES: ReadonlyArray<ModeButtonDef> = [
  {
    mode: "default",
    label: "Default",
    description: "Compact summary card per scene",
    Icon: Square,
  },
  {
    mode: "storyboard",
    label: "Storyboard",
    description: "Keyframe grid for every shot",
    Icon: LayoutDashboard,
  },
  {
    mode: "video",
    label: "Video",
    description: "Play the merged scene composite",
    Icon: Film,
  },
  {
    mode: "scripting",
    label: "Scripting",
    description: "Script-formatted shot list with dialogue",
    Icon: ScrollText,
  },
]

export function ViewModeToggle() {
  const mode = useSceneViewModeStore((s) => s.canvasWideMode)
  const setMode = useSceneViewModeStore((s) => s.setCanvasWideMode)

  function handleClick(clicked: SceneViewMode) {
    setMode(mode === clicked ? null : clicked)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="radiogroup"
        aria-label="Scene View Modes"
        data-testid="view-mode-toggle"
        className={cn(
          "flex items-center gap-0.5 p-1 rounded-xl",
          "backdrop-blur-md",
          "bg-white/80 border border-[#E2E8F0] shadow-sm",
          "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-lg dark:shadow-black/20",
        )}
      >
        {MODES.map(({ mode: m, label, description, Icon }) => {
          const active = mode === m
          return (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  data-testid={`view-mode-toggle-${m}`}
                  onClick={() => handleClick(m)}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200",
                    "text-[#64748B] dark:text-[#94A3B8]",
                    "hover:bg-[#F1F5F9] hover:text-[#0F172A]",
                    "dark:hover:bg-[#2D2D2D] dark:hover:text-white",
                    active &&
                      "bg-[#ff0073]/10 text-[#ff0073] dark:bg-[#ff0073]/20 dark:text-[#ff0073]",
                  )}
                >
                  <Icon className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className={cn(
                  "rounded-lg px-3 py-2",
                  "bg-white text-[#1E293B] border border-[#E2E8F0] shadow-sm",
                  "dark:bg-[#2D2D2D] dark:text-[#E2E8F0] dark:border-[#3D3D3D] dark:shadow-xl",
                )}
              >
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  {description}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

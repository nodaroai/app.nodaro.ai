import { Columns, Rows, LayoutGrid, Maximize, GitCompareArrows } from "lucide-react"
import type { PresentationViewMode } from "@/hooks/use-workflow-store"

const VIEW_MODES: { mode: PresentationViewMode; icon: typeof Columns; label: string }[] = [
  { mode: "horizontal", icon: Columns, label: "Horizontal split" },
  { mode: "vertical", icon: Rows, label: "Vertical stack" },
  { mode: "gallery", icon: LayoutGrid, label: "Gallery grid" },
  { mode: "fullscreen", icon: Maximize, label: "Fullscreen slideshow" },
  { mode: "compare", icon: GitCompareArrows, label: "Compare side-by-side" },
]

interface ViewModeSelectorProps {
  viewMode: PresentationViewMode
  onChange: (mode: PresentationViewMode) => void
}

export function ViewModeSelector({ viewMode, onChange }: ViewModeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={label}
          className={`flex items-center justify-center w-8 h-7 rounded-md transition-colors ${
            viewMode === mode
              ? "bg-[#ff0073]/10 text-[#ff0073]"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}

import { Columns, Rows, LayoutGrid, Maximize, GitCompareArrows, MessageSquare } from "lucide-react"
import type { PresentationViewMode } from "@/hooks/use-workflow-store"
import { useT, type MessageKey } from "@/lib/i18n"

/** Every view mode, with its icon and the dictionary key of its name —
 *  consumers render the name with `t(label)`. */
export const VIEW_MODES: { mode: PresentationViewMode; icon: typeof Columns; label: MessageKey }[] = [
  { mode: "horizontal", icon: Columns, label: "viewMode.horizontal" },
  { mode: "vertical", icon: Rows, label: "viewMode.vertical" },
  { mode: "gallery", icon: LayoutGrid, label: "viewMode.gallery" },
  { mode: "fullscreen", icon: Maximize, label: "viewMode.fullscreen" },
  { mode: "compare", icon: GitCompareArrows, label: "viewMode.compare" },
  { mode: "chat", icon: MessageSquare, label: "viewMode.chat" },
]

/** All view mode values, derived from VIEW_MODES */
export const ALL_VIEW_MODES: PresentationViewMode[] = VIEW_MODES.map((m) => m.mode)

interface ViewModeSelectorProps {
  viewMode: PresentationViewMode
  onChange: (mode: PresentationViewMode) => void
  allowedModes?: PresentationViewMode[]
}

export function ViewModeSelector({ viewMode, onChange, allowedModes }: ViewModeSelectorProps) {
  const t = useT()
  const modes = allowedModes
    ? VIEW_MODES.filter((m) => allowedModes.includes(m.mode))
    : VIEW_MODES

  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {modes.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={t(label)}
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

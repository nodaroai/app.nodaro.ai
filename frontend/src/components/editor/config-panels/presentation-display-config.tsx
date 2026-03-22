import { Columns2, Columns3, Columns4, Rows3 } from "lucide-react"
import type { PresentationDisplay } from "@/types/nodes"

const COLUMN_OPTIONS: { value: 1 | 2 | 3 | 4; icon: React.ReactNode; label: string }[] = [
  { value: 1, icon: <Rows3 className="w-3.5 h-3.5" />, label: "1" },
  { value: 2, icon: <Columns2 className="w-3.5 h-3.5" />, label: "2" },
  { value: 3, icon: <Columns3 className="w-3.5 h-3.5" />, label: "3" },
  { value: 4, icon: <Columns4 className="w-3.5 h-3.5" />, label: "4" },
]

const SIZE_OPTIONS: { value: "sm" | "md" | "lg"; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
]

interface PresentationDisplayConfigProps {
  display: PresentationDisplay
  onChange: (display: PresentationDisplay) => void
  /** Show element size control (hide for text-only nodes) */
  showElementSize?: boolean
  /** Available view modes (only for nodes with multiple views, e.g. loop) */
  viewModes?: { value: string; label: string }[]
}

export function PresentationDisplayConfig({
  display,
  onChange,
  showElementSize = true,
  viewModes,
}: PresentationDisplayConfigProps) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
        Presentation
      </p>

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">Columns per row</p>
        <div className="flex gap-1">
          {COLUMN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...display, columns: opt.value })}
              className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                display.columns === opt.value
                  ? "bg-[#ff0073]/15 text-[#ff0073] border border-[#ff0073]/30"
                  : "bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted"
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {showElementSize && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Element size</p>
          <div className="flex gap-1">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...display, elementSize: opt.value })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  display.elementSize === opt.value
                    ? "bg-[#ff0073]/15 text-[#ff0073] border border-[#ff0073]/30"
                    : "bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewModes && viewModes.length > 1 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">View mode</p>
          <div className="flex gap-1">
            {viewModes.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...display, viewMode: opt.value })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  display.viewMode === opt.value
                    ? "bg-[#ff0073]/15 text-[#ff0073] border border-[#ff0073]/30"
                    : "bg-muted/50 text-muted-foreground border border-transparent hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

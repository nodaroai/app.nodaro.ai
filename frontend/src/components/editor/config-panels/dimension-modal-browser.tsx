"use client"

import { type ReactNode, memo, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { DimensionTileGrid } from "./dimension-tile-grid"

export interface DimensionEntry {
  readonly id: string
  readonly label: string
  readonly description: string
}

/**
 * Modal-browser shell wrapping `DimensionTileGrid`. Used when a dimension
 * has too many entries to show inline (e.g. Styling.hair-cut, 45 entries).
 *
 * Two trigger styles:
 * - `full` — wide pill showing the current selection (icon + label + chevron),
 *   used as the standalone picker.
 * - `compact` — small accent button for embedding alongside a chip grid as
 *   a "Pick by look" affordance.
 *
 * Single-dimension parameter nodes (Pose) skip this entirely and render
 * `DimensionTileGrid` directly — no modal needed when the picker IS the
 * whole node.
 */
export const DimensionModalBrowser = memo(function DimensionModalBrowser({
  entries,
  value,
  onChange,
  title,
  placeholder = "Choose…",
  renderIcon,
  fallbackIcon,
  className,
  triggerVariant = "full",
  triggerLabel = "Pick by look",
}: {
  readonly entries: ReadonlyArray<DimensionEntry>
  readonly value: string | undefined
  readonly onChange: (id: string | undefined) => void
  readonly title: string
  readonly placeholder?: string
  readonly renderIcon: (entry: DimensionEntry, isSelected: boolean) => ReactNode
  readonly fallbackIcon?: ReactNode
  readonly className?: string
  readonly triggerVariant?: "full" | "compact"
  readonly triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? entries.find((e) => e.id === value) : undefined
  const displayLabel = selected?.label ?? placeholder

  const handlePick = (id: string | undefined) => {
    onChange(id)
    if (id) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerVariant === "compact" ? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:bg-[#ff0073]/5 hover:border-[#ff0073]/40 hover:text-[#ff0073] transition-colors text-[10px] font-medium px-1.5 py-0.5 text-gray-600 dark:text-[#94A3B8]",
              className,
            )}
          >
            <Sparkles className="size-2.5 shrink-0" />
            {triggerLabel}
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] px-2.5 py-2 text-left hover:border-gray-300 dark:hover:border-[#3D3D3D] transition-colors w-full min-w-0",
              className,
            )}
          >
            {selected ? (
              <div className="size-7 shrink-0 flex items-center justify-center text-gray-700 dark:text-[#E2E8F0]">
                {renderIcon(selected, false)}
              </div>
            ) : (
              <div className="size-7 shrink-0 flex items-center justify-center text-muted-foreground">
                {fallbackIcon}
              </div>
            )}
            <span className="flex-1 truncate text-xs text-gray-700 dark:text-[#E2E8F0]">
              {displayLabel}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          <DimensionTileGrid
            entries={entries}
            value={value}
            onChange={handlePick}
            renderIcon={renderIcon}
            searchPlaceholder={title}
            autoFocusSearch
            showClear
          />
        </div>
      </DialogContent>
    </Dialog>
  )
})

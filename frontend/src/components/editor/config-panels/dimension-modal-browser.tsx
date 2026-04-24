"use client"

import { type ReactNode, memo, useMemo, useState } from "react"
import { ChevronDown, Search, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface DimensionEntry {
  readonly id: string
  readonly label: string
  readonly description: string
}

/**
 * Generic modal-browser picker for dimensions with too many entries to show
 * inline. Replaces the hair-style-browser with a reusable shell so Pose /
 * Build / Facial Hair / Eyewear / Headwear can all use the same pattern
 * without copy-pasting.
 *
 * The caller supplies the filtered entry list (already belongs to one
 * dimension), the icon renderer for each tile, the dialog title, and an
 * optional fallback icon for the "nothing selected" state. Selection +
 * clearing bubble up through a single `onChange(id | undefined)` callback.
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
  /** `full` = wide pill showing the current selection (icon + label + chevron),
   *  used as the standalone picker. `compact` = small accent button for
   *  embedding alongside a chip grid as a "Pick by look" affordance. */
  readonly triggerVariant?: "full" | "compact"
  /** Label for the compact trigger. Ignored in `full` variant. */
  readonly triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = useMemo<ReadonlyArray<DimensionEntry>>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    )
  }, [query, entries])

  const selected = value ? entries.find((e) => e.id === value) : undefined
  const displayLabel = selected?.label ?? placeholder

  const handlePick = (id: string) => {
    onChange(id)
    setOpen(false)
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

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            aria-label={title}
            placeholder={title}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              No match for &quot;{query}&quot;
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label={title}
              className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2"
            >
              {filtered.map((entry) => {
                const isSelected = entry.id === value
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    title={entry.description}
                    onClick={() => handlePick(entry.id)}
                    className={cn(
                      "group flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors cursor-pointer",
                      isSelected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <div
                      className={cn(
                        "size-14 flex items-center justify-center",
                        isSelected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {renderIcon(entry, isSelected)}
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-medium leading-tight text-center",
                        isSelected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {entry.label}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selected && (
          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
            className="self-start text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear selection
          </button>
        )}
      </DialogContent>
    </Dialog>
  )
})

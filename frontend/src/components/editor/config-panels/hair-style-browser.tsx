"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, Search, Scissors } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PEOPLE, type Person } from "@nodaro-shared/person"
import { cn } from "@/lib/utils"
import { HairIcon } from "./hair-icon"

/**
 * Modal browser for the hair-style dimension of the Person node.
 *
 * Person has 45 hair-style entries — rendering them inline in the side
 * config panel is unwieldy (15+ rows of tiles, pushing every dimension
 * below it offscreen). Instead the section collapses to a single trigger
 * button that shows the current pick; clicking it opens a full-width
 * modal with search + tile grid, same pattern as VoiceBrowser. User
 * picks, modal closes, PersonPicker shows the new selection.
 *
 * Icons come from `HairIcon` (tiny silhouette SVGs, ~48×48 viewport).
 */
export const HairStyleBrowser = memo(function HairStyleBrowser({
  value,
  onChange,
  className,
}: {
  readonly value: string | undefined
  readonly onChange: (hairStyleId: string | undefined) => void
  readonly className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const hairStyles = useMemo(
    () => PEOPLE.filter((p) => p.dimension === "hair-style"),
    [],
  )

  const filtered = useMemo<ReadonlyArray<Person>>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return hairStyles
    return hairStyles.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    )
  }, [query, hairStyles])

  const selected = value ? hairStyles.find((p) => p.id === value) : undefined
  const displayLabel = selected?.label ?? "Choose hair style…"

  const handlePick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] px-2.5 py-2 text-left hover:border-gray-300 dark:hover:border-[#3D3D3D] transition-colors w-full min-w-0",
            className,
          )}
        >
          {selected ? (
            <HairIcon
              hairStyleId={selected.id}
              className="size-7 shrink-0 text-gray-700 dark:text-[#E2E8F0]"
            />
          ) : (
            <div className="size-7 shrink-0 flex items-center justify-center text-muted-foreground">
              <Scissors className="size-3.5" />
            </div>
          )}
          <span className="flex-1 truncate text-xs text-gray-700 dark:text-[#E2E8F0]">
            {displayLabel}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Choose Hair Style</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            aria-label="Search hair styles"
            placeholder="Search hair styles"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">
              No hair styles match &quot;{query}&quot;
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label="Hair styles"
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
                    <HairIcon
                      hairStyleId={entry.id}
                      className={cn(
                        "size-14",
                        isSelected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    />
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

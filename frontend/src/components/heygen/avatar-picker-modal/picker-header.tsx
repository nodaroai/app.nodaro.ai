"use client"

// Header of the Avatar Picker modal: title + live count · search (⌘K / Ctrl+K)
// · Grid/List · close.

import { forwardRef } from "react"
import { LayoutGrid, List, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useRovingRadiogroup } from "./use-roving-radiogroup"

export type PickerView = "grid" | "list"

interface PickerHeaderProps {
  readonly subtitle: string
  readonly total: string
  readonly query: string
  readonly onQuery: (q: string) => void
  readonly view: PickerView
  readonly onView: (v: PickerView) => void
}

/** "⌘K" on a Mac, "Ctrl K" elsewhere — the handler accepts both. */
export function searchShortcutLabel(platform: string = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /mac|iphone|ipad/i.test(platform) ? "⌘K" : "Ctrl K"
}

const VIEWS: readonly PickerView[] = ["grid", "list"]

export const PickerHeader = forwardRef<HTMLInputElement, PickerHeaderProps>(function PickerHeader(
  { subtitle, total, query, onQuery, view, onView },
  searchRef,
) {
  const roving = useRovingRadiogroup(VIEWS.length, VIEWS.indexOf(view), (i) => onView(VIEWS[i]))

  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border/60 px-5 py-4">
      <div className="flex flex-col gap-[3px]">
        <DialogTitle className="whitespace-nowrap text-[16px] font-semibold tracking-[-0.01em]">Choose an avatar</DialogTitle>
        <DialogDescription className="whitespace-nowrap text-[12px] text-muted-foreground" data-testid="avatar-picker-count">
          {subtitle}
        </DialogDescription>
      </div>
      <div className="flex flex-1 justify-center">
        <label className="flex w-full max-w-[420px] items-center gap-2.5 rounded-[9px] border border-border/70 bg-muted/40 px-3.5 py-2.5 focus-within:border-[#ff0073]/60">
          <Search className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={`Search ${total} avatars by name, look or scene`}
            aria-label="Search avatars"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-muted-foreground/70 outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <kbd className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap">{searchShortcutLabel()}</kbd>
        </label>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-[3px]" role="radiogroup" aria-label="View">
        {VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            aria-label={v === "grid" ? "Grid" : "List"}
            onClick={() => onView(v)}
            {...roving(i)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors",
              view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "grid" ? <LayoutGrid className="size-3.5" aria-hidden /> : <List className="size-3.5" aria-hidden />}
            {v === "grid" ? "Grid" : "List"}
          </button>
        ))}
      </div>
      <DialogClose asChild>
        <button type="button" aria-label="Close" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </DialogClose>
    </div>
  )
})

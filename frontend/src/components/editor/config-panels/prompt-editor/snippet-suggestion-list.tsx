"use client"

import { forwardRef, useImperativeHandle, useState, useEffect, useMemo } from "react"
import { Scissors } from "lucide-react"
import type { SnippetPoolItem } from "@/lib/snippet-pool"

export interface SnippetSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SnippetSuggestionListProps {
  items: readonly SnippetPoolItem[]
  command: (item: SnippetPoolItem) => void
}

/**
 * Dropdown shown when the user types `/` in a prompt field. Flat keyboard
 * order (the `items` array), visually grouped by category with sticky
 * headers — user snippets first (the pool builder puts them first), then
 * factory categories. Enter AND Tab accept; Esc is handled by the
 * Suggestion plugin (dismiss-and-stay-dismissed).
 */
export const SnippetSuggestionList = forwardRef<SnippetSuggestionListHandle, SnippetSuggestionListProps>(
  function SnippetSuggestionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => { setSelectedIndex(0) }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (items.length === 0) return false
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selectedIndex]
          if (item) command(item)
          return true
        }
        return false
      },
    }), [items, selectedIndex, command])

    // Group consecutive items by category for headers; keyboard order stays flat.
    const groups = useMemo(() => {
      const out: Array<{ category: string; entries: Array<{ item: SnippetPoolItem; index: number }> }> = []
      items.forEach((item, index) => {
        const last = out[out.length - 1]
        if (last && last.category === item.category) last.entries.push({ item, index })
        else out.push({ category: item.category, entries: [{ item, index }] })
      })
      return out
    }, [items])

    // Auto-hide on zero matches (slash-menu convention): render nothing.
    if (items.length === 0) return null

    return (
      <div className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-[min(300px,calc(100vh-80px))] w-[340px]">
        {groups.map((g) => (
          <div key={g.category}>
            <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-2.5 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/50">
              {g.category}
            </div>
            {g.entries.map(({ item, index }) => {
              const isSelected = index === selectedIndex
              return (
                <button
                  key={item.source + item.id}
                  type="button"
                  data-index={index}
                  className={`w-full text-left px-2.5 py-1.5 cursor-pointer transition-colors flex items-start gap-2 ${
                    isSelected
                      ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    command(item)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <Scissors className={`w-3 h-3 mt-0.5 shrink-0 ${isSelected ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground/70"}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-medium truncate">{item.name}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{item.text}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  },
)

"use client"

import { forwardRef, useImperativeHandle, useState, useEffect } from "react"
import type { RefImageItem } from "../tag-textarea"

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SuggestionListProps {
  items: readonly RefImageItem[]
  command: (item: RefImageItem) => void
}

/**
 * Dropdown shown when the user types `@`. Mirrors the visual treatment of
 * TagTextarea's autocomplete: thumbnail + label + position badge, grouped
 * into a single list. Keyboard navigation handled via the imperative handle
 * exposed to Tiptap's suggestion plugin.
 */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(
  function SuggestionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

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
        if (event.key === "Enter") {
          const item = items[selectedIndex]
          if (item) command(item)
          return true
        }
        return false
      },
    }), [items, selectedIndex, command])

    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-popover shadow-lg py-1 px-3 text-[11px] text-muted-foreground">
          No reference images
        </div>
      )
    }

    return (
      <div className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-64">
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex
          return (
            <button
              key={`${item.index}-${item.url}`}
              type="button"
              data-index={idx}
              className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                isSelected
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "hover:bg-muted text-foreground"
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                command(item)
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <img
                src={item.url}
                alt=""
                className="w-7 h-7 rounded object-cover shrink-0 border border-border/40"
              />
              <span className="truncate flex-1 min-w-0">#{item.index} {item.label}</span>
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                  isSelected
                    ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                    : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                }`}
              >
                @image:{item.index}:{item.defaultLabel}
              </span>
            </button>
          )
        })}
      </div>
    )
  },
)

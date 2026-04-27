"use client"

import { forwardRef, useImperativeHandle, useState, useEffect } from "react"
import type { NodeRefItem } from "@/lib/node-refs"

export interface VariableSuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface VariableSuggestionListProps {
  items: readonly NodeRefItem[]
  command: (item: NodeRefItem) => void
}

const TYPE_CATEGORY: Record<string, string> = {
  "text-prompt": "Text",
  "ai-writer": "Text",
  "list": "Text",
  "loop": "Text",
  "generate-image": "Image",
  "upload-image": "Image",
  "edit-image": "Image",
  "image-to-image": "Image",
  "character": "Image",
  "face": "Image",
  "object": "Image",
  "location": "Image",
  "scene": "Image",
  "image-to-video": "Video",
  "text-to-video": "Video",
  "video-to-video": "Video",
  "upload-video": "Video",
  "youtube-video": "Video",
  "combine-videos": "Video",
  "extend-video": "Video",
  "text-to-speech": "Audio",
  "generate-music": "Audio",
  "text-to-audio": "Audio",
  "upload-audio": "Audio",
  "suno-generate": "Audio",
}

function categoryFor(type: string): string {
  return TYPE_CATEGORY[type] ?? "Node"
}

/**
 * Dropdown shown when the user types `{`. Lists upstream node references
 * grouped by category. Mirrors the visual treatment of the `@` (image)
 * dropdown so the editor feels consistent.
 */
export const VariableSuggestionList = forwardRef<VariableSuggestionListHandle, VariableSuggestionListProps>(
  function VariableSuggestionList({ items, command }, ref) {
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
          No upstream variables
        </div>
      )
    }

    return (
      <div className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-64 min-w-[220px]">
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex
          return (
            <button
              key={item.id}
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
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                  isSelected
                    ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                    : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                }`}
              >
                {`{${item.label}}`}
              </span>
              <span className="truncate flex-1 min-w-0">{item.label}</span>
              <span className="text-[9px] text-muted-foreground/70 shrink-0 uppercase tracking-wider">
                {categoryFor(item.type)}
              </span>
            </button>
          )
        })}
      </div>
    )
  },
)

"use client"

import { forwardRef, useImperativeHandle, useState, useEffect, useMemo, useCallback } from "react"
import type { RefImageItem } from "../tag-textarea"

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SuggestionListProps {
  /** Full, unfiltered reference list. The list applies query + drill filtering internally. */
  items: readonly RefImageItem[]
  /** Current typed text after the `@` trigger (used for client-side filtering). */
  query: string
  /** Insert the resolved leaf item (variant or non-character ref). */
  command: (item: RefImageItem) => void
  /**
   * Called when the list pushes or pops the drill-in state. The parent uses
   * this to clear any typed filter text between the `@` and the cursor so the
   * new view starts with an empty filter (mirrors `TagTextarea`'s drill UX).
   */
  onDrillChange?: () => void
}

/**
 * Display row discriminator. The dropdown is a hierarchical picker:
 *
 *   - "back":            top row inside drill-in view, pops back to root
 *   - "character-root":  one row per character at root view; clicking drills in
 *   - "variant":         leaf variant inside drill-in view; clicking inserts
 *   - "image-ref":       non-character ref (uploaded / wired-image), inserted directly
 */
type DisplayRow =
  | { kind: "back"; characterName: string }
  | { kind: "character-root"; item: RefImageItem; variantCount: number; characterSlug: string }
  | { kind: "variant"; item: RefImageItem }
  | { kind: "image-ref"; item: RefImageItem }

/**
 * Dropdown shown when the user types `@`. Hierarchical picker:
 *
 *   Root view: 1 entry per character (canonical thumbnail + name) + the
 *              non-character refs (uploaded / wired-image) inline at the
 *              bottom. Selecting a character drills in instead of inserting.
 *
 *   Drill-in:  "← back (Name)" row + that character's variants. Selecting a
 *              variant fires `command(item)` and the parent inserts
 *              `@<char>:<N>(:<variant>)?` plain text into the editor.
 *
 * Non-character refs (`source !== "character"`) bypass the drill-in entirely
 * and use the legacy `{image:N:role}` TipTap node insertion.
 *
 * Mirrors `TagTextarea`'s hierarchical UX so generate-image / image-to-image /
 * modify-image have identical @-mention semantics to image-to-video.
 */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(
  function SuggestionList({ items, query, command, onDrillChange }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    // Drill-in state: when non-null, the dropdown shows that character's
    // variants instead of the root character list. Reset when the dropdown
    // closes (`onExit` unmounts this component).
    const [drillCharacterSlug, setDrillCharacterSlug] = useState<string | null>(null)

    // Group character items by characterSlug; keep non-character refs flat.
    const { characterGroups, nonCharacterItems } = useMemo(() => {
      const groups = new Map<string, RefImageItem[]>()
      const others: RefImageItem[] = []
      for (const item of items) {
        if (item.source === "character" && item.characterSlug) {
          const g = groups.get(item.characterSlug) ?? []
          g.push(item)
          groups.set(item.characterSlug, g)
        } else {
          others.push(item)
        }
      }
      return { characterGroups: groups, nonCharacterItems: others }
    }, [items])

    // Compute the rows to display based on drill state + query.
    const displayRows = useMemo<DisplayRow[]>(() => {
      const q = query.trim().toLowerCase()
      // Drill-in: back row + this character's variants.
      if (drillCharacterSlug) {
        const variants = characterGroups.get(drillCharacterSlug) ?? []
        const canonical = variants.find((v) => !v.variantSlug)
        const characterName = canonical?.label ?? drillCharacterSlug
        // Back row always visible (navigation, not data).
        const rows: DisplayRow[] = [{ kind: "back", characterName }]
        for (const v of variants) {
          if (q && !(v.label.toLowerCase().includes(q) || (v.variantDisplayName ?? "").toLowerCase().includes(q))) continue
          rows.push({ kind: "variant", item: v })
        }
        return rows
      }
      // Root: non-character refs (filtered) + one row per character (filtered).
      const rows: DisplayRow[] = []
      for (const r of nonCharacterItems) {
        if (q && !(r.label.toLowerCase().includes(q) || String(r.index).includes(q) || r.defaultLabel.toLowerCase().includes(q))) continue
        rows.push({ kind: "image-ref", item: r })
      }
      for (const [slug, group] of characterGroups) {
        const canonical = group.find((i) => !i.variantSlug) ?? group[0]
        if (q && !(canonical.label.toLowerCase().includes(q) || slug.toLowerCase().includes(q))) continue
        rows.push({ kind: "character-root", item: canonical, variantCount: group.length, characterSlug: slug })
      }
      return rows
    }, [characterGroups, nonCharacterItems, drillCharacterSlug, query])

    // Reset selection whenever the rendered rows change.
    useEffect(() => {
      // Skip the back row by default in drill-in view so the first variant is
      // highlighted.
      const skipBack = displayRows[0]?.kind === "back" && displayRows.length > 1
      setSelectedIndex(skipBack ? 1 : 0)
    }, [displayRows])

    const handleSelect = useCallback((row: DisplayRow) => {
      if (row.kind === "back") {
        setDrillCharacterSlug(null)
        onDrillChange?.()
        return
      }
      if (row.kind === "character-root") {
        setDrillCharacterSlug(row.characterSlug)
        onDrillChange?.()
        return
      }
      // "variant" or "image-ref" — fire the parent's command to insert.
      command(row.item)
    }, [command, onDrillChange])

    useImperativeHandle(ref, () => ({
      onKeyDown(event: KeyboardEvent) {
        if (displayRows.length === 0) return false
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % displayRows.length)
          return true
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i - 1 + displayRows.length) % displayRows.length)
          return true
        }
        if (event.key === "Enter") {
          const row = displayRows[selectedIndex]
          if (row) handleSelect(row)
          return true
        }
        if (event.key === "Backspace" && drillCharacterSlug && query.length === 0) {
          // In drill-in view with empty filter, Backspace pops back to root
          // instead of deleting the `@` (which would close the popup).
          setDrillCharacterSlug(null)
          onDrillChange?.()
          return true
        }
        return false
      },
    }), [displayRows, selectedIndex, handleSelect, drillCharacterSlug, query, onDrillChange])

    if (displayRows.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-popover shadow-lg py-1 px-3 text-[11px] text-muted-foreground">
          {items.length === 0 ? "No reference images" : "No matches"}
        </div>
      )
    }

    return (
      <div className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-64 min-w-[240px]">
        {displayRows.map((row, idx) => {
          const isSelected = idx === selectedIndex
          if (row.kind === "back") {
            return (
              <button
                key="back"
                type="button"
                data-index={idx}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 border-b border-border/50 ${
                  isSelected
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "hover:bg-muted text-muted-foreground"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(row)
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="font-medium">&larr; back ({row.characterName})</span>
              </button>
            )
          }
          if (row.kind === "character-root") {
            const { item, variantCount } = row
            return (
              <button
                key={`char-${row.characterSlug}`}
                type="button"
                data-index={idx}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(row)
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <img
                  src={item.url}
                  alt=""
                  className="w-7 h-7 rounded object-cover shrink-0 border border-border/40"
                />
                <span className="truncate flex-1 min-w-0">
                  {item.label}
                  {variantCount > 1 && (
                    <span className="text-slate-500 ml-1">/ {variantCount} variants</span>
                  )}
                </span>
                <span className="text-slate-500 text-[12px] leading-4 shrink-0" aria-hidden>
                  &rsaquo;
                </span>
              </button>
            )
          }
          // "variant" or "image-ref" — leaf rows with thumbnail + tag pill.
          const { item } = row
          const tagPreview = row.kind === "variant"
            ? (item.variantSlug
                ? `@${item.characterSlug}:N:${item.variantSlug}`
                : `@${item.characterSlug}:N`)
            : `@image:${item.index}:${item.defaultLabel}`
          return (
            <button
              key={`${row.kind}-${item.index}-${item.variantSlug ?? "canonical"}`}
              type="button"
              data-index={idx}
              className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                isSelected
                  ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "hover:bg-muted text-foreground"
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(row)
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <img
                src={item.url}
                alt=""
                className="w-7 h-7 rounded object-cover shrink-0 border border-border/40"
              />
              <span className="truncate flex-1 min-w-0">
                {row.kind === "image-ref"
                  ? <>#{item.index} {item.label}</>
                  : <>
                      {item.label}
                      {item.variantDisplayName && item.variantDisplayName !== "canonical" && (
                        <span className="text-slate-500 ml-1">/ {item.variantDisplayName}</span>
                      )}
                    </>
                }
              </span>
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                  isSelected
                    ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                    : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                }`}
              >
                {tagPreview}
              </span>
            </button>
          )
        })}
      </div>
    )
  },
)

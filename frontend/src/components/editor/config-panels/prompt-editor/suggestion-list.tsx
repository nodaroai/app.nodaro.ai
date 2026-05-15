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
 * Display row discriminator. The dropdown is a hybrid picker:
 *
 *   - "back":            top row inside drill-in view, pops back to root
 *   - "character-root":  one row per character at root view; clicking drills in
 *   - "variant":         leaf variant — inside drill-in view OR a flat-search
 *                        result. `flatSearch=true` opts the row into the
 *                        "Kira / smile" full-path label.
 *   - "image-ref":       non-character ref (uploaded / wired-image), inserted directly
 */
type DisplayRow =
  | { kind: "back"; characterName: string }
  | { kind: "character-root"; item: RefImageItem; variantCount: number; characterSlug: string }
  | { kind: "variant"; item: RefImageItem; flatSearch?: boolean; characterLabel?: string }
  | { kind: "image-ref"; item: RefImageItem }

/**
 * Dropdown shown when the user types `@`. Hybrid picker:
 *
 *   Empty query (just `@` typed): HIERARCHICAL root view — 1 entry per
 *              character (canonical thumbnail + name) + non-character refs
 *              (uploaded / wired-image) inline at the bottom. Selecting a
 *              character drills in instead of inserting.
 *
 *   Drill-in:  "← back (Name)" row + that character's variants. Selecting a
 *              variant fires `command(item)` and the parent inserts
 *              `@<char>:<N>(:<variant>)?` plain text into the editor.
 *
 *   Non-empty query (user typed something after `@`): FLAT search — every
 *              character ref (canonical + variants) plus matching
 *              non-character refs, filtered by character name, variant name,
 *              character slug, or variant slug. Each row shows the full path
 *              ("Kira / smile") so users distinguish identically-named
 *              variants across characters. Drill-in is bypassed; selecting a
 *              result inserts directly.
 *
 * Non-character refs (`source !== "character"`) always use the legacy
 * `{image:N:role}` TipTap node insertion in both modes.
 *
 * Mirrors `TagTextarea`'s hybrid UX so generate-image / image-to-image /
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

      // FLAT SEARCH MODE — when the user has typed something after `@`,
      // surface every character ref (canonical + variants) so typing `@smile`
      // finds Kira's smile expression directly. Filter matches character
      // name, variant name, character slug, or variant slug. Drill-in is
      // bypassed; each row shows the full path ("Kira / smile").
      if (q.length > 0) {
        const rows: DisplayRow[] = []
        for (const [slug, group] of characterGroups) {
          const canonical = group.find((i) => !i.variantSlug) ?? group[0]
          const charLabel = canonical.label || slug
          const charName = charLabel.toLowerCase()
          for (const v of group) {
            const variantName = (v.variantDisplayName ?? "").toLowerCase()
            const variantSlug = (v.variantSlug ?? "").toLowerCase()
            const fullSlug = v.variantSlug ? `${slug}:${variantName}` : slug
            // Legacy hyphen form (e.g. "kira-smile") for compatibility with
            // users who type the old slug shape.
            const legacySlug = v.variantSlug ? `${slug}-${variantSlug}` : slug
            if (
              charName.includes(q)
              || variantName.includes(q)
              || slug.toLowerCase().includes(q)
              || variantSlug.includes(q)
              || fullSlug.includes(q)
              || legacySlug.includes(q)
            ) {
              rows.push({ kind: "variant", item: v, flatSearch: true, characterLabel: charLabel })
            }
          }
        }
        // Non-character refs filtered by label, index, or default-label.
        for (const r of nonCharacterItems) {
          if (
            r.label.toLowerCase().includes(q)
            || String(r.index).includes(q)
            || r.defaultLabel.toLowerCase().includes(q)
          ) {
            rows.push({ kind: "image-ref", item: r })
          }
        }
        return rows
      }

      // Drill-in: back row + this character's variants.
      if (drillCharacterSlug) {
        const variants = characterGroups.get(drillCharacterSlug) ?? []
        const canonical = variants.find((v) => !v.variantSlug)
        const characterName = canonical?.label ?? drillCharacterSlug
        // Back row always visible (navigation, not data).
        const rows: DisplayRow[] = [{ kind: "back", characterName }]
        for (const v of variants) {
          rows.push({ kind: "variant", item: v })
        }
        return rows
      }

      // Root (empty query): non-character refs + one row per character.
      const rows: DisplayRow[] = []
      for (const r of nonCharacterItems) {
        rows.push({ kind: "image-ref", item: r })
      }
      for (const [slug, group] of characterGroups) {
        const canonical = group.find((i) => !i.variantSlug) ?? group[0]
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

    // Hybrid mode orthogonality: when the user types a non-empty filter while
    // drilled into a character, reset the drill state so the flat-search
    // results aren't masked by the drill bucket. Clearing the filter back to
    // empty resumes the hierarchical root view automatically.
    useEffect(() => {
      if (query.trim().length > 0 && drillCharacterSlug) {
        setDrillCharacterSlug(null)
      }
    }, [query, drillCharacterSlug])

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
          // In flat-search mode, the parent character label is hoisted into
          // the row so the user can distinguish identically-named variants
          // across characters ("Kira / smile" vs "Aria / smile"). The normal
          // drill-in row keeps its existing two-tone label.
          const useFullPath = row.kind === "variant" && row.flatSearch === true
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
                  : useFullPath
                    ? <>
                        {row.characterLabel ?? item.label}
                        {item.variantDisplayName && item.variantDisplayName !== "canonical" && (
                          <span className="text-slate-500 ml-1">/ {item.variantDisplayName}</span>
                        )}
                      </>
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

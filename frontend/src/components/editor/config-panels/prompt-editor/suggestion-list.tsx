"use client"

import { forwardRef, useImperativeHandle, useState, useEffect, useMemo, useCallback } from "react"
import { USAGE_MODES, usageModeLabel, type UsageMode } from "@nodaro/shared"
import type { RefImageItem } from "../tag-textarea"
import { TrainedPill } from "@/components/editor/trained-pill"

/**
 * Command payload — the resolved leaf item, plus an optional per-mention
 * `usageMode` chosen at insertion time via the mode-picker drill (3rd level
 * of the hierarchical autocomplete). When present, the parent appends the
 * mode as the 4th slug segment (`@kira:1:smile:face`) regardless of the
 * character node's default. When absent, the parent falls back to the
 * character's `defaultUsageMode` and the legacy 2/3-part insertion rules.
 */
export type SuggestionCommandPayload = RefImageItem & { usageMode?: UsageMode }

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SuggestionListProps {
  /** Full, unfiltered reference list. The list applies query + drill filtering internally. */
  items: readonly RefImageItem[]
  /** Current typed text after the `@` trigger (used for client-side filtering). */
  query: string
  /** Insert the resolved leaf item (variant or non-character ref). */
  command: (item: SuggestionCommandPayload) => void
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
 *   - "back":            top row inside drill-in view, pops back one level
 *   - "character-root":  one row per character at root view; clicking drills in
 *   - "variant":         leaf variant — inside drill-in view OR a flat-search
 *                        result. `flatSearch=true` opts the row into the
 *                        "Kira / smile" full-path label. In the character-drill
 *                        view, an additional small chip on the row drills one
 *                        more level into the mode picker.
 *   - "mode":            one row per usage mode in the 3rd-level drill view.
 *                        Selecting inserts the slug with that mode appended.
 *   - "image-ref":       non-character ref (uploaded / wired-image), inserted directly
 */
type DisplayRow =
  | { kind: "back"; label: string }
  | { kind: "character-root"; item: RefImageItem; variantCount: number; characterSlug: string }
  | { kind: "variant"; item: RefImageItem; flatSearch?: boolean; characterLabel?: string }
  | { kind: "mode"; mode: UsageMode }
  | { kind: "image-ref"; item: RefImageItem }

/** Active drill-in target for the mode picker (3rd level). */
interface DrillVariant {
  characterSlug: string
  variantSlug: string | null
  characterName: string
  variantDisplayName: string | null
  item: RefImageItem
}

/**
 * Dropdown shown when the user types `@`. Hybrid picker with three drill levels:
 *
 *   Empty query (just `@` typed): HIERARCHICAL root view — 1 entry per
 *              character (canonical thumbnail + name) + non-character refs
 *              (uploaded / wired-image) inline at the bottom. Selecting a
 *              character drills in instead of inserting.
 *
 *   Drill-in (level 2 — variants): "← back (Name)" row + that character's
 *              variants. Selecting a variant body (Enter / click row) fires
 *              `command(item)` and inserts `@kira:1:smile` using the
 *              character's default mode (legacy behavior preserved).
 *              Right-arrow OR clicking the trailing chip on the variant row
 *              drills one more level into the mode picker.
 *
 *   Drill-in (level 3 — mode picker, NEW): "← back (variant)" row + the six
 *              usage modes. Selecting a mode fires `command({ ...item, usageMode })`
 *              and inserts `@kira:1:smile:face`. Typing filters the modes
 *              (e.g. "f" → "Face only" / "Face + Pose").
 *
 *   Non-empty query (user typed something after `@`): FLAT search — every
 *              character ref (canonical + variants) plus matching
 *              non-character refs, filtered by character name, variant name,
 *              character slug, or variant slug. Each row shows the full path
 *              ("Kira / smile") so users distinguish identically-named
 *              variants across characters. Drill-in is bypassed; selecting a
 *              result inserts directly with the character's default mode.
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
    // Drill-in state — two levels:
    //   `drillCharacterSlug` selects a character (level 2: variant list).
    //   `drillVariant` selects a variant within that character (level 3: mode picker).
    // Both reset when the dropdown closes (`onExit` unmounts this component).
    const [drillCharacterSlug, setDrillCharacterSlug] = useState<string | null>(null)
    const [drillVariant, setDrillVariant] = useState<DrillVariant | null>(null)

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

      // MODE PICKER (3rd-level drill). Filter by usage-mode label.
      if (drillVariant) {
        const backLabel = `back (${drillVariant.variantDisplayName ?? drillVariant.characterName})`
        const modes = q.length > 0
          ? USAGE_MODES.filter((m) =>
              usageModeLabel(m).toLowerCase().includes(q) || m.toLowerCase().includes(q),
            )
          : USAGE_MODES
        const rows: DisplayRow[] = [{ kind: "back", label: backLabel }]
        for (const m of modes) {
          rows.push({ kind: "mode", mode: m })
        }
        return rows
      }

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

      // Drill-in (level 2): back row + this character's variants.
      if (drillCharacterSlug) {
        const variants = characterGroups.get(drillCharacterSlug) ?? []
        const canonical = variants.find((v) => !v.variantSlug)
        const characterName = canonical?.label ?? drillCharacterSlug
        // Back row always visible (navigation, not data).
        const rows: DisplayRow[] = [{ kind: "back", label: `back (${characterName})` }]
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
    }, [characterGroups, nonCharacterItems, drillCharacterSlug, drillVariant, query])

    // Reset selection whenever the rendered rows change.
    useEffect(() => {
      // Skip the back row by default in drill-in view so the first data row is
      // highlighted.
      const skipBack = displayRows[0]?.kind === "back" && displayRows.length > 1
      setSelectedIndex(skipBack ? 1 : 0)
    }, [displayRows])

    // Hybrid mode orthogonality: when the user types a non-empty filter while
    // drilled into a character (but NOT in mode-picker view — there typing
    // filters the modes themselves), reset the character drill so the
    // flat-search results aren't masked. Clearing the filter back to empty
    // resumes the hierarchical root view automatically.
    useEffect(() => {
      if (query.trim().length > 0 && drillCharacterSlug && !drillVariant) {
        setDrillCharacterSlug(null)
      }
    }, [query, drillCharacterSlug, drillVariant])

    // Drill into the mode picker for a given variant row.
    const drillIntoMode = useCallback((item: RefImageItem) => {
      if (item.source !== "character" || !item.characterSlug) return
      // Resolve the character's display name from the canonical entry in the
      // same group (the variant row's `label` is the canonical name; the
      // variant name is in `variantDisplayName`).
      const group = characterGroups.get(item.characterSlug) ?? []
      const canonical = group.find((v) => !v.variantSlug) ?? group[0]
      const characterName = canonical?.label ?? item.characterSlug
      const variantDisplayName = item.variantDisplayName && item.variantDisplayName !== "canonical"
        ? item.variantDisplayName
        : null
      setDrillVariant({
        characterSlug: item.characterSlug,
        variantSlug: item.variantSlug ?? null,
        characterName,
        variantDisplayName,
        item,
      })
      onDrillChange?.()
    }, [characterGroups, onDrillChange])

    const handleSelect = useCallback((row: DisplayRow) => {
      if (row.kind === "back") {
        // Pop one level: mode → variant; variant → root.
        if (drillVariant) {
          setDrillVariant(null)
        } else {
          setDrillCharacterSlug(null)
        }
        onDrillChange?.()
        return
      }
      if (row.kind === "character-root") {
        setDrillCharacterSlug(row.characterSlug)
        onDrillChange?.()
        return
      }
      if (row.kind === "mode") {
        if (drillVariant) {
          command({ ...drillVariant.item, usageMode: row.mode })
        }
        return
      }
      // "variant" or "image-ref" — fire the parent's command to insert with
      // the character's default mode (legacy behavior, preserved).
      command(row.item)
    }, [command, onDrillChange, drillVariant])

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
        if (event.key === "ArrowRight") {
          // In the character-drill view (level 2), Right on a variant row
          // drills into the mode picker. Anywhere else, it falls through
          // (lets the cursor move in the underlying textarea).
          if (drillCharacterSlug && !drillVariant) {
            const row = displayRows[selectedIndex]
            if (row?.kind === "variant" && row.item.source === "character") {
              drillIntoMode(row.item)
              return true
            }
          }
          return false
        }
        if (event.key === "ArrowLeft") {
          // In the mode picker (level 3), Left pops back to the variant view.
          if (drillVariant) {
            setDrillVariant(null)
            onDrillChange?.()
            return true
          }
          return false
        }
        if (event.key === "Enter") {
          const row = displayRows[selectedIndex]
          if (row) handleSelect(row)
          return true
        }
        if (event.key === "Backspace" && query.length === 0) {
          // In drill-in views with empty filter, Backspace pops back one
          // level (mode → variant → root) instead of deleting the `@`
          // (which would close the popup).
          if (drillVariant) {
            setDrillVariant(null)
            onDrillChange?.()
            return true
          }
          if (drillCharacterSlug) {
            setDrillCharacterSlug(null)
            onDrillChange?.()
            return true
          }
        }
        return false
      },
    }), [displayRows, selectedIndex, handleSelect, drillCharacterSlug, drillVariant, query, onDrillChange, drillIntoMode])

    if (displayRows.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-popover shadow-lg py-1 px-3 text-[11px] text-muted-foreground">
          {items.length === 0 ? "No reference images" : "No matches"}
        </div>
      )
    }

    return (
      // Viewport-relative cap so the dropdown is always scrollable in-place
      // instead of clipping off-screen. The fixed 300px cap is the desired
      // size on a tall viewport; the `min()` constraint trims it on short
      // screens (e.g. a small laptop with multiple panels open). The mount's
      // `top` is set by `positionMount` in `prompt-editor/index.tsx`, which
      // also flips above the cursor when there isn't enough room below.
      <div className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-[min(300px,calc(100vh-80px))] min-w-[240px]">
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
                <span className="font-medium">&larr; {row.label}</span>
              </button>
            )
          }
          if (row.kind === "mode") {
            return (
              <button
                key={`mode-${row.mode}`}
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
                <span className="truncate flex-1 min-w-0">{usageModeLabel(row.mode)}</span>
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                    isSelected
                      ? "border-sky-400/60 bg-sky-500/20 text-sky-700 dark:text-sky-200"
                      : "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                  }`}
                >
                  :{row.mode}
                </span>
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
                {item.loraTrainingStatus === "succeeded" && <TrainedPill size="xs" />}
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
          // In the character-drill view (level 2), every character variant
          // row gets a small "mode" chip that drills into the mode picker.
          // Flat-search rows skip the chip — drilling from a search result
          // would be confusing (the user already filtered to a specific
          // variant; the mode is a separate concern best set after picking).
          const showModeChip = row.kind === "variant"
            && !row.flatSearch
            && item.source === "character"
            && !!item.characterSlug
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
              {showModeChip && (
                <span
                  role="button"
                  aria-label="Pick usage mode"
                  title="Pick usage mode (or press Right arrow)"
                  className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium leading-4 shrink-0 cursor-pointer transition-colors ${
                    isSelected
                      ? "border-sky-400/60 bg-sky-500/10 text-sky-700 dark:text-sky-200 hover:bg-sky-500/25"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onMouseDown={(e) => {
                    // Stop the row's onMouseDown from also firing (which
                    // would insert with the default mode instead of drilling).
                    e.preventDefault()
                    e.stopPropagation()
                    drillIntoMode(item)
                  }}
                >
                  mode &rsaquo;
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  },
)

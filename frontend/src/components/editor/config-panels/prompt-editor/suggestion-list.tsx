"use client"

import { forwardRef, useImperativeHandle, useState, useEffect, useMemo, useCallback } from "react"
import {
  USAGE_MODES,
  usageModeLabel,
  LOCATION_USAGE_MODES,
  locationUsageModeLabel,
  type UsageMode,
  type LocationUsageMode,
} from "@nodaro/shared"
import type { RefImageItem } from "../tag-textarea"
import { TrainedPill } from "@/components/editor/trained-pill"

/**
 * Command payload — the resolved leaf item, plus an optional per-mention
 * `usageMode` chosen at insertion time via the mode-picker drill (3rd level
 * of the hierarchical autocomplete).
 *
 * Two mode flavors travel together because the same payload type is used for
 * both character refs (8 modes) and location refs (a strict 4-mode subset).
 * The parent's `command` handler in `prompt-editor/index.tsx` discriminates
 * on `item.source` (`"character"` vs `"location"`) when deciding which slug
 * shape to insert.
 *
 * When present, the parent appends the mode as the trailing slug segment
 * regardless of the source node's default. When absent, the parent falls
 * back to the source node's `defaultUsageMode` and the legacy 2/3-part
 * insertion rules.
 */
export type SuggestionCommandPayload = RefImageItem & {
  /** Character usage-mode override (only meaningful when `source === "character"`). */
  usageMode?: UsageMode
  /** Location usage-mode override (only meaningful when `source === "location"`). */
  locationUsageMode?: LocationUsageMode
}

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
 * Display row discriminator. The dropdown is a hybrid picker — three drill
 * levels for both characters and locations:
 *
 *   - "back":              top row inside any drill-in view, pops back one level
 *   - "character-root":    one row per character at root view; clicking drills in
 *   - "variant":           leaf variant — inside drill-in view OR a flat-search
 *                          result. `flatSearch=true` opts the row into the
 *                          "Kira / smile" full-path label. In the character-drill
 *                          view, an additional small chip on the row drills one
 *                          more level into the mode picker.
 *   - "mode":              one row per character usage mode in the 3rd-level
 *                          drill view. Selecting inserts the slug with that
 *                          mode appended.
 *   - "image-ref":         non-character ref (uploaded / wired-image), inserted directly
 *   - "location-root":     one row per location at root view; clicking drills in
 *                          to the location's variant list (level 2). Trailing
 *                          chip shows the variant count.
 *   - "location-variant":  leaf variant within a location's drill view OR a
 *                          flat-search result. `flatSearch=true` opts the row
 *                          into the "Old Library / weather / rain" full-path
 *                          label. `kind === "canonical"` denotes the
 *                          location's canonical (no bucket/variant) entry.
 *                          In the location-drill view, a trailing chip
 *                          drills into the mode picker (level 3).
 *   - "location-mode":     one row per location usage mode in the 3rd-level
 *                          location drill view. Selecting inserts the slug
 *                          with the location mode appended (4th slug segment
 *                          for variant entries, 3rd for canonical).
 */
type DisplayRow =
  | { kind: "back"; label: string }
  | { kind: "character-root"; item: RefImageItem; variantCount: number; characterSlug: string }
  | { kind: "variant"; item: RefImageItem; flatSearch?: boolean; characterLabel?: string }
  | { kind: "mode"; mode: UsageMode }
  | { kind: "image-ref"; item: RefImageItem }
  | {
      kind: "location-root"
      item: RefImageItem
      variantCount: number
      locationSlug: string
    }
  | {
      kind: "location-variant"
      item: RefImageItem
      /** "canonical" for the bucketless main entry, "variant" for bucketed entries. */
      variantKind: "canonical" | "variant"
      flatSearch?: boolean
      locationLabel?: string
    }
  | { kind: "location-mode"; mode: LocationUsageMode }

/** Active drill-in target for the character mode picker (3rd level). */
interface DrillVariant {
  characterSlug: string
  variantSlug: string | null
  characterName: string
  variantDisplayName: string | null
  item: RefImageItem
}

/** Active drill-in target for the location mode picker (3rd level). */
interface DrillLocationVariant {
  locationSlug: string
  bucket: string | null
  variant: string | null
  locationName: string
  /** Display label for the row (e.g. "rain" or "canonical"). */
  variantDisplayName: string | null
  item: RefImageItem
}

/**
 * Dropdown shown when the user types `@`. Hybrid picker with three drill
 * levels each for characters and locations:
 *
 *   Empty query (just `@` typed): HIERARCHICAL root view — 1 entry per
 *              character (canonical thumbnail + name) + 1 entry per
 *              location (canonical thumbnail + name) + non-character refs
 *              (uploaded / wired-image) inline at the top. Selecting a
 *              character OR location drills in instead of inserting.
 *
 *   Character drill (level 2 — variants): "← back (Name)" row + that
 *              character's variants. Selecting a variant body fires
 *              `command(item)` and inserts `@kira:1:smile` using the
 *              character's default mode (legacy behavior preserved).
 *              Right-arrow / trailing chip drills into the character mode
 *              picker (level 3).
 *
 *   Character mode picker (level 3): "← back (variant)" row + the 8 usage
 *              modes. Selecting fires `command({ ...item, usageMode })` and
 *              inserts `@kira:1:smile:face`.
 *
 *   Location drill (level 2 — variants): "← back (Location)" row + a
 *              canonical row + one row per bucketed variant. Selecting the
 *              canonical row inserts `@oldlibrary:N`; selecting a variant
 *              inserts `@oldlibrary:N:weather/rain`. Right-arrow / trailing
 *              chip drills into the location mode picker (level 3).
 *
 *   Location mode picker (level 3, NEW IN SLICE 4): "← back (variant)" row
 *              + the 4 location modes. Selecting a mode fires
 *              `command({ ...item, locationUsageMode })` and inserts the
 *              slug with `:<mode>` appended — as the 4th segment for
 *              bucketed variants (`@oldlibrary:N:weather/rain:style`) or
 *              the 3rd segment for the canonical entry
 *              (`@oldlibrary:N:style`).
 *
 *   Non-empty query (user typed something after `@`): FLAT search — every
 *              character ref + every location ref (canonical + variants) +
 *              matching non-character refs, filtered by name, slug,
 *              variant, or bucket. Each location row shows the full path
 *              ("Old Library / weather / rain") so users can distinguish
 *              identically-named variants across locations. Drill-in is
 *              bypassed; selecting a result inserts directly with the
 *              source node's default mode.
 *
 * Non-character/non-location refs (`source !== "character" && source !==
 * "location"`) always use the legacy `{image:N:role}` TipTap node insertion.
 */
export const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(
  function SuggestionList({ items, query, command, onDrillChange }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    // Drill-in state — three independent levels split across two trees:
    //   `drillCharacterSlug` (character level 2: variant list).
    //   `drillVariant` (character level 3: mode picker).
    //   `drillLocationSlug` (location level 2: bucketed variant list).
    //   `drillLocationVariant` (location level 3: location mode picker).
    // All reset when the dropdown closes (`onExit` unmounts this component).
    const [drillCharacterSlug, setDrillCharacterSlug] = useState<string | null>(null)
    const [drillVariant, setDrillVariant] = useState<DrillVariant | null>(null)
    const [drillLocationSlug, setDrillLocationSlug] = useState<string | null>(null)
    const [drillLocationVariant, setDrillLocationVariant] = useState<DrillLocationVariant | null>(null)

    // Group character items by characterSlug; group location items by
    // locationSlug; keep all other refs flat.
    const { characterGroups, locationGroups, nonCharacterItems } = useMemo(() => {
      const charGroups = new Map<string, RefImageItem[]>()
      const locGroups = new Map<string, RefImageItem[]>()
      const others: RefImageItem[] = []
      for (const item of items) {
        if (item.source === "character" && item.characterSlug) {
          const g = charGroups.get(item.characterSlug) ?? []
          g.push(item)
          charGroups.set(item.characterSlug, g)
        } else if (item.source === "location" && item.locationSlug) {
          const g = locGroups.get(item.locationSlug) ?? []
          g.push(item)
          locGroups.set(item.locationSlug, g)
        } else {
          others.push(item)
        }
      }
      return { characterGroups: charGroups, locationGroups: locGroups, nonCharacterItems: others }
    }, [items])

    // Compute the rows to display based on drill state + query.
    const displayRows = useMemo<DisplayRow[]>(() => {
      const q = query.trim().toLowerCase()

      // LOCATION MODE PICKER (3rd-level drill, NEW). Filter by mode label.
      if (drillLocationVariant) {
        const backLabel = `back (${drillLocationVariant.variantDisplayName ?? drillLocationVariant.locationName})`
        const modes = q.length > 0
          ? LOCATION_USAGE_MODES.filter((m) =>
              locationUsageModeLabel(m).toLowerCase().includes(q) || m.toLowerCase().includes(q),
            )
          : LOCATION_USAGE_MODES
        const rows: DisplayRow[] = [{ kind: "back", label: backLabel }]
        for (const m of modes) {
          rows.push({ kind: "location-mode", mode: m })
        }
        return rows
      }

      // CHARACTER MODE PICKER (3rd-level drill). Filter by usage-mode label.
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
      // surface every character ref + location ref + image ref. Drill-in is
      // bypassed; each row shows the full path ("Kira / smile" or
      // "Old Library / weather / rain").
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
        // Location refs filtered by location label, slug, bucket, or variant
        // name. Flat-search across canonical + every per-variant entry,
        // mirroring the character flat-search shape (no drill).
        for (const [slug, group] of locationGroups) {
          const canonical = group.find((i) => !i.locationVariantBucket) ?? group[0]
          const locLabel = canonical.label || slug
          for (const l of group) {
            const labelLc = locLabel.toLowerCase()
            const slugLc = slug.toLowerCase()
            const variantLc = (l.locationVariantSlug ?? "").toLowerCase()
            const bucketLc = (l.locationVariantBucket ?? "").toLowerCase()
            const variantDisplayLc = (l.locationVariantDisplayName ?? "").toLowerCase()
            if (
              labelLc.includes(q)
              || slugLc.includes(q)
              || variantLc.includes(q)
              || bucketLc.includes(q)
              || variantDisplayLc.includes(q)
            ) {
              const variantKind: "canonical" | "variant" = l.locationVariantBucket && l.locationVariantSlug
                ? "variant"
                : "canonical"
              rows.push({
                kind: "location-variant",
                item: l,
                variantKind,
                flatSearch: true,
                locationLabel: locLabel,
              })
            }
          }
        }
        // Non-character/non-location refs filtered by label, index, or default-label.
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

      // LOCATION drill-in (level 2): back row + canonical row + that
      // location's bucketed variants.
      if (drillLocationSlug) {
        const variants = locationGroups.get(drillLocationSlug) ?? []
        const canonical = variants.find((v) => !v.locationVariantBucket)
        const locationName = canonical?.label ?? drillLocationSlug
        const rows: DisplayRow[] = [{ kind: "back", label: `back (${locationName})` }]
        // Emit canonical first when present, then bucketed variants.
        if (canonical) {
          rows.push({ kind: "location-variant", item: canonical, variantKind: "canonical" })
        }
        for (const v of variants) {
          if (v === canonical) continue
          rows.push({ kind: "location-variant", item: v, variantKind: "variant" })
        }
        return rows
      }

      // CHARACTER drill-in (level 2): back row + this character's variants.
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

      // Root (empty query): non-character refs + one row per character +
      // one row per location.
      const rows: DisplayRow[] = []
      for (const r of nonCharacterItems) {
        rows.push({ kind: "image-ref", item: r })
      }
      for (const [slug, group] of characterGroups) {
        const canonical = group.find((i) => !i.variantSlug) ?? group[0]
        rows.push({ kind: "character-root", item: canonical, variantCount: group.length, characterSlug: slug })
      }
      for (const [slug, group] of locationGroups) {
        const canonical = group.find((i) => !i.locationVariantBucket) ?? group[0]
        rows.push({ kind: "location-root", item: canonical, variantCount: group.length, locationSlug: slug })
      }
      return rows
    }, [
      characterGroups,
      locationGroups,
      nonCharacterItems,
      drillCharacterSlug,
      drillVariant,
      drillLocationSlug,
      drillLocationVariant,
      query,
    ])

    // Reset selection whenever the rendered rows change.
    useEffect(() => {
      // Skip the back row by default in drill-in view so the first data row is
      // highlighted.
      const skipBack = displayRows[0]?.kind === "back" && displayRows.length > 1
      setSelectedIndex(skipBack ? 1 : 0)
    }, [displayRows])

    // Hybrid mode orthogonality: when the user types a non-empty filter while
    // drilled into a character/location (but NOT in a mode-picker view —
    // there typing filters the modes themselves), reset the drill state so
    // the flat-search results aren't masked. Clearing the filter back to
    // empty resumes the hierarchical root view automatically.
    useEffect(() => {
      if (query.trim().length === 0) return
      if (drillCharacterSlug && !drillVariant) setDrillCharacterSlug(null)
      if (drillLocationSlug && !drillLocationVariant) setDrillLocationSlug(null)
    }, [query, drillCharacterSlug, drillVariant, drillLocationSlug, drillLocationVariant])

    // Drill into the character mode picker for a given variant row.
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

    // Drill into the location mode picker for a given location variant row.
    // Works for both canonical entries (no bucket/variant) and bucketed
    // variants — the mode applies to whichever slug shape the row represents.
    const drillIntoLocationMode = useCallback((item: RefImageItem) => {
      if (item.source !== "location" || !item.locationSlug) return
      const group = locationGroups.get(item.locationSlug) ?? []
      const canonical = group.find((v) => !v.locationVariantBucket) ?? group[0]
      const locationName = canonical?.label ?? item.locationSlug
      const bucket = item.locationVariantBucket ?? null
      const variant = item.locationVariantSlug ?? null
      const variantDisplayName = bucket && variant
        ? (item.locationVariantDisplayName && item.locationVariantDisplayName !== "canonical"
            ? item.locationVariantDisplayName
            : variant)
        : null
      setDrillLocationVariant({
        locationSlug: item.locationSlug,
        bucket,
        variant,
        locationName,
        variantDisplayName,
        item,
      })
      onDrillChange?.()
    }, [locationGroups, onDrillChange])

    const handleSelect = useCallback((row: DisplayRow) => {
      if (row.kind === "back") {
        // Pop one level. Order matters: check the deepest drill state first.
        if (drillVariant) {
          setDrillVariant(null)
        } else if (drillLocationVariant) {
          setDrillLocationVariant(null)
        } else if (drillCharacterSlug) {
          setDrillCharacterSlug(null)
        } else if (drillLocationSlug) {
          setDrillLocationSlug(null)
        }
        onDrillChange?.()
        return
      }
      if (row.kind === "character-root") {
        setDrillCharacterSlug(row.characterSlug)
        onDrillChange?.()
        return
      }
      if (row.kind === "location-root") {
        setDrillLocationSlug(row.locationSlug)
        onDrillChange?.()
        return
      }
      if (row.kind === "mode") {
        if (drillVariant) {
          command({ ...drillVariant.item, usageMode: row.mode })
        }
        return
      }
      if (row.kind === "location-mode") {
        if (drillLocationVariant) {
          command({ ...drillLocationVariant.item, locationUsageMode: row.mode })
        }
        return
      }
      // "variant", "image-ref", or "location-variant" — fire the parent's
      // command to insert. The location-variant rows insert via the
      // locationRef pill with the location's default mode (no mode override).
      command(row.item)
    }, [command, onDrillChange, drillVariant, drillLocationVariant, drillCharacterSlug, drillLocationSlug])

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
          // drills into the character mode picker. In the location-drill
          // view (level 2), Right on a location-variant row drills into the
          // location mode picker. Anywhere else, it falls through (lets the
          // cursor move in the underlying textarea).
          if (drillCharacterSlug && !drillVariant) {
            const row = displayRows[selectedIndex]
            if (row?.kind === "variant" && row.item.source === "character") {
              drillIntoMode(row.item)
              return true
            }
          }
          if (drillLocationSlug && !drillLocationVariant) {
            const row = displayRows[selectedIndex]
            if (row?.kind === "location-variant" && row.item.source === "location") {
              drillIntoLocationMode(row.item)
              return true
            }
          }
          return false
        }
        if (event.key === "ArrowLeft") {
          // In any mode picker (level 3), Left pops back to the variant view.
          if (drillVariant) {
            setDrillVariant(null)
            onDrillChange?.()
            return true
          }
          if (drillLocationVariant) {
            setDrillLocationVariant(null)
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
          if (drillLocationVariant) {
            setDrillLocationVariant(null)
            onDrillChange?.()
            return true
          }
          if (drillCharacterSlug) {
            setDrillCharacterSlug(null)
            onDrillChange?.()
            return true
          }
          if (drillLocationSlug) {
            setDrillLocationSlug(null)
            onDrillChange?.()
            return true
          }
        }
        return false
      },
    }), [
      displayRows,
      selectedIndex,
      handleSelect,
      drillCharacterSlug,
      drillVariant,
      drillLocationSlug,
      drillLocationVariant,
      query,
      onDrillChange,
      drillIntoMode,
      drillIntoLocationMode,
    ])

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
      <div
        className="z-[9999] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1 max-h-[min(300px,calc(100vh-80px))] min-w-[240px]"
        data-testid="suggestion-list"
      >
        {displayRows.map((row, idx) => {
          const isSelected = idx === selectedIndex
          if (row.kind === "back") {
            return (
              <button
                key="back"
                type="button"
                data-index={idx}
                data-row-kind="back"
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
                data-row-kind="mode"
                data-mode={row.mode}
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
          if (row.kind === "location-mode") {
            return (
              <button
                key={`loc-mode-${row.mode}`}
                type="button"
                data-index={idx}
                data-row-kind="location-mode"
                data-mode={row.mode}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(row)
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="truncate flex-1 min-w-0">{locationUsageModeLabel(row.mode)}</span>
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                    isSelected
                      ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-700 dark:text-cyan-200"
                      : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
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
                data-row-kind="character-root"
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
          if (row.kind === "location-root") {
            const { item, variantCount } = row
            return (
              <button
                key={`loc-${row.locationSlug}`}
                type="button"
                data-index={idx}
                data-row-kind="location-root"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
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
          if (row.kind === "location-variant") {
            const { item, variantKind } = row
            const tagPreview = variantKind === "variant"
                && item.locationVariantBucket
                && item.locationVariantSlug
              ? `@${item.locationSlug}:N:${item.locationVariantBucket}/${item.locationVariantSlug}`
              : `@${item.locationSlug}:N`
            // In the location-drill view (level 2), every variant row gets a
            // small "mode" chip that drills into the location mode picker.
            // Flat-search rows skip the chip (mirrors the character behavior).
            const showModeChip = !row.flatSearch
            const useFullPath = row.flatSearch === true
            return (
              <button
                key={`loc-var-${item.locationSlug}-${item.locationVariantBucket ?? "canonical"}-${item.locationVariantSlug ?? ""}-${item.index}`}
                type="button"
                data-index={idx}
                data-row-kind="location-variant"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors flex items-center gap-2 ${
                  isSelected
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
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
                  {useFullPath
                    ? <>
                        {row.locationLabel ?? item.label}
                        {variantKind === "variant" && item.locationVariantBucket && (
                          <span className="text-slate-500 ml-1">
                            / {item.locationVariantBucket}
                            {item.locationVariantSlug && ` / ${item.locationVariantDisplayName && item.locationVariantDisplayName !== "canonical" ? item.locationVariantDisplayName : item.locationVariantSlug}`}
                          </span>
                        )}
                        {variantKind === "canonical" && (
                          <span className="text-slate-500 ml-1">/ canonical</span>
                        )}
                      </>
                    : <>
                        {variantKind === "canonical" ? "canonical" : (
                          <>
                            {item.locationVariantBucket}
                            <span className="text-slate-500"> / {item.locationVariantDisplayName && item.locationVariantDisplayName !== "canonical" ? item.locationVariantDisplayName : item.locationVariantSlug}</span>
                          </>
                        )}
                      </>
                  }
                </span>
                <span
                  className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-mono font-medium leading-4 shrink-0 ${
                    isSelected
                      ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-700 dark:text-cyan-200"
                      : "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                  }`}
                >
                  {tagPreview}
                </span>
                {showModeChip && (
                  <span
                    role="button"
                    aria-label="Pick usage mode"
                    title="Pick usage mode (or press Right arrow)"
                    data-testid="location-variant-mode-chip"
                    className={`inline-flex items-center rounded-md border px-1.5 py-0 text-[10px] font-medium leading-4 shrink-0 cursor-pointer transition-colors ${
                      isSelected
                        ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-500/25"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      drillIntoLocationMode(item)
                    }}
                  >
                    mode &rsaquo;
                  </span>
                )}
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
              data-row-kind={row.kind}
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

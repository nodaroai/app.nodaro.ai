"use client"

import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import type { I18nCatalogId } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import type { DimensionEntry } from "./dimension-modal-browser"
import { MultiPickBadge, useMultiPick, type MultiPickValue } from "./multi-pick-ui"

/** Multi-pick value: undefined / single id / array of ids (1..maxSelected). */
export type DimensionPickValue = MultiPickValue

/**
 * Opt-in commit channel for tile grids. When a provider supplies a `commit`
 * handler, double-clicking a tile selects the entry AND fires `commit()` —
 * used by the fullscreen config panel to close itself on a double-click pick,
 * a "make my choice and get out of my way" shortcut. Plain side-panel pickers
 * don't wrap, so double-click is a no-op there.
 */
export const TileCommitContext = createContext<{ readonly commit: () => void } | null>(null)

/**
 * Search-first tile grid for picking one entry from a list of dimension
 * options. Used inline by single-dimension parameter nodes (e.g. PoseConfig)
 * and inside DimensionModalBrowser's dialog content for multi-dim cases
 * (e.g. Styling.hair-cut). Keeps the visual + interaction language identical
 * across both placements so users see the same picker either way.
 *
 * Pass `catalog` to enable i18n: labels/descriptions auto-localize and search
 * filters across both English and the user's current locale.
 */
export function DimensionTileGrid({
  entries,
  value,
  onChange,
  renderIcon,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches",
  className,
  gridClassName = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2",
  autoFocusSearch = false,
  showClear = false,
  catalog,
  maxSelected = 1,
}: {
  readonly entries: ReadonlyArray<DimensionEntry>
  readonly value: DimensionPickValue
  readonly onChange: (value: DimensionPickValue) => void
  readonly renderIcon: (entry: DimensionEntry, isSelected: boolean) => ReactNode
  readonly searchPlaceholder?: string
  readonly emptyMessage?: string
  readonly className?: string
  readonly gridClassName?: string
  readonly autoFocusSearch?: boolean
  readonly showClear?: boolean
  readonly catalog?: I18nCatalogId
  /** Max simultaneous picks. 1 = single (back-compat). >1 = multi-pick with
   *  numbered tile badges and FIFO replace when full. */
  readonly maxSelected?: number
}) {
  const [query, setQuery] = useState("")
  const i18n = useLocalizedCatalog(catalog ?? ("__noop__" as I18nCatalogId))

  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onChange, maxSelected)

  const commitCtx = useContext(TileCommitContext)

  // Stable refs so the native event listener doesn't need to re-register when
  // onChange / handlePick identities change between renders.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const handlePickRef = useRef(handlePick)
  handlePickRef.current = handlePick

  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const handler = (ev: Event) => {
      const { action, id } = (ev as CustomEvent<{ action: "single" | "multi"; id: string }>).detail
      if (action === "single") {
        // Force single-select regardless of current multi mode
        onChangeRef.current(id)
      } else {
        handlePickRef.current(id)
      }
    }
    el.addEventListener("picker-select", handler)
    return () => el.removeEventListener("picker-select", handler)
  }, [])

  const filtered = useMemo<ReadonlyArray<DimensionEntry>>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    if (catalog) {
      return entries.filter((e) => i18n.matches(e.id, e.label, e.description, query))
    }
    return entries.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    )
  }, [query, entries, catalog, i18n])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          autoFocus={autoFocusSearch}
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-8">
          {emptyMessage} {query && <>&quot;{query}&quot;</>}
        </div>
      ) : (
        <div
          ref={gridRef}
          role={maxSelected > 1 ? "group" : "radiogroup"}
          aria-label={searchPlaceholder}
          className={gridClassName}
          data-picker-grid="true"
          data-multi={maxSelected > 1 ? "true" : "false"}
        >
          {filtered.map((entry) => {
            const selectedIndex = selectedIds.indexOf(entry.id)
            const isSelected = selectedIndex >= 0
            const label = catalog ? i18n.resolveLabel(entry.id, entry.label) : entry.label
            const description = catalog
              ? i18n.resolveDescription(entry.id, entry.description)
              : entry.description
            return (
              <div key={entry.id} className="relative">
                <button
                  type="button"
                  role={maxSelected > 1 ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  title={description}
                  data-entry-id={entry.id}
                  onClick={() => handlePick(entry.id)}
                  onDoubleClick={(e) => {
                    // First click already fired handlePick via onClick; the
                    // second click fires it again (idempotent for single-pick,
                    // re-cycles for multi-pick — acceptable). Then commit so
                    // the host (fullscreen config panel) can close.
                    handlePick(entry.id)
                    commitCtx?.commit()
                    // Stop the dblclick from bubbling to the panel-level
                    // delegation (which also closes fullscreen). When this
                    // tile grid lives inside a modal browser opened ON TOP
                    // of a fullscreen panel, the override commit closes the
                    // modal — we must NOT also close the panel beneath.
                    e.stopPropagation()
                  }}
                  className={cn(
                    "w-full group flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors cursor-pointer",
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
                  <FitText
                    text={label}
                    className={cn(
                      "text-[10px] font-medium leading-tight text-center",
                      isSelected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                    )}
                  />
                </button>
                {isSelected && (
                  <MultiPickBadge
                    mode={isMulti ? "multi" : "single"}
                    index={selectedIndex}
                    maxSelected={maxSelected}
                    onActivate={() => activateMulti(entry.id)}
                    onDemote={() => demoteToSingle(entry.id)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {showClear && selectedIds.length > 0 && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="self-start text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear selection
        </button>
      )}
    </div>
  )
}

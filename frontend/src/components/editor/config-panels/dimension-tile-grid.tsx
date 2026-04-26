"use client"

import { type ReactNode, useMemo, useState } from "react"
import { Search } from "lucide-react"
import type { I18nCatalogId } from "@nodaro-shared/i18n"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import type { DimensionEntry } from "./dimension-modal-browser"

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
}: {
  readonly entries: ReadonlyArray<DimensionEntry>
  readonly value: string | undefined
  readonly onChange: (id: string | undefined) => void
  readonly renderIcon: (entry: DimensionEntry, isSelected: boolean) => ReactNode
  readonly searchPlaceholder?: string
  readonly emptyMessage?: string
  readonly className?: string
  readonly gridClassName?: string
  readonly autoFocusSearch?: boolean
  readonly showClear?: boolean
  readonly catalog?: I18nCatalogId
}) {
  const [query, setQuery] = useState("")
  // Always call the hook to keep order stable; pass a sentinel catalog id when
  // i18n is disabled. The resolver falls back to English when no sidecar exists.
  const i18n = useLocalizedCatalog(catalog ?? ("__noop__" as I18nCatalogId))

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
        <div role="radiogroup" className={gridClassName}>
          {filtered.map((entry) => {
            const isSelected = entry.id === value
            const label = catalog ? i18n.resolveLabel(entry.id, entry.label) : entry.label
            const description = catalog
              ? i18n.resolveDescription(entry.id, entry.description)
              : entry.description
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                title={description}
                onClick={() => onChange(entry.id)}
                className={cn(
                  "group flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors cursor-pointer",
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
                <span
                  className={cn(
                    "text-[10px] font-medium leading-tight text-center",
                    isSelected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                  )}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showClear && value && (
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

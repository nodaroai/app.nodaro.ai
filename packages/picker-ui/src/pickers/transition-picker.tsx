"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { TRANSITIONS as BASE_TRANSITIONS, TRANSITION_CATEGORY_LABELS, TRANSITION_CATEGORY_ORDER, type Transition, type TransitionCategory } from "@nodaro/prompts"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"
import { useCuratedEntries } from "../curated.js"

/**
 * Every interface string the picker renders around its tiles. The package owns
 * no dictionary, so the host passes these in its own language; a field added
 * here is a compile error at every host that passes `copy` until it translates
 * it. Tile labels and descriptions come from the catalog's locale sidecars, and
 * the category tab names go through `localizeLabel`.
 */
export interface TransitionPickerCopy {
  /** The search box placeholder, which is also its accessible name. */
  readonly searchPlaceholder: string
  /** Accessible name of the search-results grid. */
  readonly searchResults: string
  /** Accessible name of the category tab list. */
  readonly categories: string
  /** The pick counter under the search box ("1 / 2 selected"). */
  readonly selectedCount: (n: number, max: number) => string
  /** Accessible name of a tab's badge counting the picks in that category. */
  readonly categorySelectedCount: (n: number) => string
  /** Shown when the search matches no transition. */
  readonly noMatch: (query: string) => string
}

/** The English copy, used when the host passes none. */
export const TRANSITION_PICKER_COPY_EN: TransitionPickerCopy = {
  searchPlaceholder: "Search transitions…",
  searchResults: "Transitions (search results)",
  categories: "Transition categories",
  selectedCount: (n, max) => `${n} / ${max} selected`,
  categorySelectedCount: (n) => `${n} selected`,
  noMatch: (query) => `No transitions match “${query}”`,
}

interface TransitionPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
  /** Localizes an English category tab name (`TRANSITION_CATEGORY_LABELS`) —
   *  the host app's option-label table. Identity when omitted. */
  readonly localizeLabel?: (english: string) => string
  /** The picker's interface strings in the host's language. English when omitted. */
  readonly copy?: TransitionPickerCopy
}

const identity = (s: string): string => s

/**
 * Multi-pick Transition picker (1–2 ids → composite transition clause).
 *
 * Catalog of 76 cinematic transitions grouped into 8 categories (standard,
 * time, element, morph, portal, physics, light, glitch). Tabs surface each
 * category in a 2-col grid; search box flattens across categories when
 * non-empty.
 *
 * Mirrors action-fx-picker UX: `+` badge promotes single→multi, numbered
 * badge demotes back. 2-cap shared with backend `composeTransitionHintFromConnections()`.
 */
export const TransitionPicker = memo(function TransitionPicker({
  value,
  onValueChange,
  className,
  maxSelected = 2,
  localizeLabel = identity,
  copy = TRANSITION_PICKER_COPY_EN,
}: TransitionPickerProps) {
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const TRANSITIONS = useCuratedEntries("transitions", BASE_TRANSITIONS)
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<TransitionCategory>("standard")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("transitions")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const isSearching = query.trim().length > 0

  const filtered: ReadonlyArray<Transition> = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TRANSITIONS
    return TRANSITIONS.filter((t) => matches(t.id, t.label, t.description, query))
  }, [query, matches])

  const byCategory = useMemo(() => {
    const m = new Map<TransitionCategory, Transition[]>()
    for (const cat of TRANSITION_CATEGORY_ORDER) m.set(cat, [])
    for (const t of filtered) m.get(t.category)?.push(t)
    return m
  }, [filtered])

  const selectedCountByCategory = useMemo(() => {
    const m = new Map<TransitionCategory, number>()
    for (const cat of TRANSITION_CATEGORY_ORDER) {
      m.set(cat, (byCategory.get(cat) ?? []).filter((t) => selectedIds.includes(t.id)).length)
    }
    return m
  }, [byCategory, selectedIds])

  const renderTile = (t: Transition) => {
    const selectedIdx = selectedIds.indexOf(t.id)
    const selected = selectedIdx >= 0
    const label = resolveLabel(t.id, t.label)
    const description = resolveDescription(t.id, t.description)
    return (
      <div key={t.id} className="relative">
        <button
          type="button"
          role={maxSelected > 1 ? "checkbox" : "radio"}
          aria-checked={selected}
          title={description}
          onClick={() => handlePick(t.id)}
          className={cn(
            "w-full group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
            selected
              ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
              : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
          )}
        >
          <span
            className={cn(
              "text-[11.5px] font-semibold leading-tight w-full",
              selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
            )}
          >
            {label}
          </span>
          <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2">
            {description}
          </span>
        </button>
        {selected && (
          <MultiPickBadge
            mode={isMulti ? "multi" : "single"}
            index={selectedIdx}
            maxSelected={maxSelected}
            onActivate={() => activateMulti(t.id)}
            onDemote={() => demoteToSingle(t.id)}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label={copy.searchPlaceholder}
          placeholder={copy.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="text-[10px] text-muted-foreground px-0.5">
        {copy.selectedCount(selectedIds.length, maxSelected)}
      </div>

      {isSearching ? (
        <>
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              {copy.noMatch(query)}
            </div>
          ) : (
            <div
              role={maxSelected > 1 ? "group" : "radiogroup"}
              aria-label={copy.searchResults}
              className="grid grid-cols-2 gap-1.5"
            >
              {filtered.map(renderTile)}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label={copy.categories}
            className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
          >
            {TRANSITION_CATEGORY_ORDER.map((cat) => {
              const active = cat === activeTab
              const count = selectedCountByCategory.get(cat) ?? 0
              const hasPick = count > 0
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(cat)}
                  className={cn(
                    "relative -mb-px inline-flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                    active
                      ? "border-[#ff0073] text-[#ff0073]"
                      : hasPick
                      ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <span>{localizeLabel(TRANSITION_CATEGORY_LABELS[cat])}</span>
                  {hasPick && (
                    <span
                      className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[4px] rounded-full bg-[#ff0073] text-white text-[9px] font-semibold leading-none"
                      aria-label={copy.categorySelectedCount(count)}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            role={maxSelected > 1 ? "group" : "radiogroup"}
            aria-label={localizeLabel(TRANSITION_CATEGORY_LABELS[activeTab])}
            className="grid grid-cols-2 gap-1.5"
          >
            {(byCategory.get(activeTab) ?? []).map(renderTile)}
          </div>
        </div>
      )}
    </div>
  )
})

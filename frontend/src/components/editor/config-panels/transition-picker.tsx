"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  TRANSITIONS,
  TRANSITION_CATEGORY_LABELS,
  TRANSITION_CATEGORY_ORDER,
  type Transition,
  type TransitionCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface TransitionPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

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
}: TransitionPickerProps) {
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
          aria-label="Search transitions"
          placeholder="Search transitions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="text-[10px] text-muted-foreground px-0.5">
        {selectedIds.length} / {maxSelected} selected
      </div>

      {isSearching ? (
        <>
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No transitions match &quot;{query}&quot;
            </div>
          ) : (
            <div
              role={maxSelected > 1 ? "group" : "radiogroup"}
              aria-label="Transitions (search results)"
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
            aria-label="Transition categories"
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
                  <span>{TRANSITION_CATEGORY_LABELS[cat]}</span>
                  {hasPick && (
                    <span
                      className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[4px] rounded-full bg-[#ff0073] text-white text-[9px] font-semibold leading-none"
                      aria-label={`${count} selected`}
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
            aria-label={TRANSITION_CATEGORY_LABELS[activeTab]}
            className="grid grid-cols-2 gap-1.5"
          >
            {(byCategory.get(activeTab) ?? []).map(renderTile)}
          </div>
        </div>
      )}
    </div>
  )
})

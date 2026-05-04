"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  ACTION_FX,
  ACTION_FX_CATEGORY_LABELS,
  ACTION_FX_CATEGORY_ORDER,
  type ActionFx,
  type ActionFxCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface ActionFxPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

/**
 * Multi-pick Action FX picker (1–2 ids → composite FX clause).
 *
 * Action FX are discrete, dramatic, high-energy events (explosions, lightning,
 * earthquakes, magic spells, sci-fi blasts). The catalog (~70 entries) is
 * grouped into 6 categories — tabs surface each category in a 2-col grid;
 * the search box flattens across all categories when non-empty.
 *
 * Visual + interaction conventions follow the rest of the multi-pick picker
 * family (atmosphere, held-prop, etc.): brand-pink selected state, the
 * `MultiPickBadge` `+`/numbered overlay for promoting between single and
 * multi mode, and the 2-cap shared with backend `buildActionFxHints()`.
 */
export const ActionFxPicker = memo(function ActionFxPicker({
  value,
  onValueChange,
  className,
  maxSelected = 2,
}: ActionFxPickerProps) {
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<ActionFxCategory>("disaster")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("action-fx")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const isSearching = query.trim().length > 0

  const filtered = useMemo(() => {
    return ACTION_FX.filter((fx) => matches(fx.id, fx.label, fx.description, query))
  }, [query, matches])

  const byCategory = useMemo(() => {
    const m = new Map<ActionFxCategory, ActionFx[]>()
    for (const cat of ACTION_FX_CATEGORY_ORDER) m.set(cat, [])
    for (const fx of filtered) m.get(fx.category)?.push(fx)
    return m
  }, [filtered])

  const renderTile = (fx: ActionFx) => {
    const selectedIdx = selectedIds.indexOf(fx.id)
    const selected = selectedIdx >= 0
    const label = resolveLabel(fx.id, fx.label)
    const description = resolveDescription(fx.id, fx.description)
    return (
      <div key={fx.id} className="relative">
        <button
          type="button"
          role={maxSelected > 1 ? "checkbox" : "radio"}
          aria-checked={selected}
          title={description}
          onClick={() => handlePick(fx.id)}
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
            onActivate={() => activateMulti(fx.id)}
            onDemote={() => demoteToSingle(fx.id)}
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
          aria-label="Search action FX"
          placeholder="Search action FX"
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
              No FX matches &quot;{query}&quot;
            </div>
          ) : (
            <div
              role={maxSelected > 1 ? "group" : "radiogroup"}
              aria-label="Action FX (search results)"
              className="grid grid-cols-2 gap-1.5"
            >
              {filtered.map(renderTile)}
            </div>
          )}
        </>
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActionFxCategory)}>
          <TabsList className="grid w-full grid-cols-3 gap-0.5 h-auto">
            {ACTION_FX_CATEGORY_ORDER.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="text-[10px] py-1.5 px-1">
                {ACTION_FX_CATEGORY_LABELS[cat]}
              </TabsTrigger>
            ))}
          </TabsList>
          {ACTION_FX_CATEGORY_ORDER.map((cat) => (
            <TabsContent key={cat} value={cat} className="mt-2">
              <div
                role={maxSelected > 1 ? "group" : "radiogroup"}
                aria-label={ACTION_FX_CATEGORY_LABELS[cat]}
                className="grid grid-cols-2 gap-1.5"
              >
                {(byCategory.get(cat) ?? []).map(renderTile)}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
})

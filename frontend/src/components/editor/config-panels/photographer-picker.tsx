"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  PHOTOGRAPHERS,
  PHOTOGRAPHER_CATEGORY_LABELS,
  PHOTOGRAPHER_CATEGORY_ORDER,
  type Photographer,
  type PhotographerCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface PhotographerPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

/**
 * Single-select photographer / artist style picker. Entries are grouped by
 * category (Editorial, Documentary, Cinematographer, Concept, Illustrator)
 * and rendered as text tiles — there's no canonical visual swatch for an
 * artist's name, so we lean on label + 1-line description. Search filters
 * across label + description.
 */
export const PhotographerPicker = memo(function PhotographerPicker({
  value,
  onValueChange,
  className,
  maxSelected = 1,
}: PhotographerPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("photographer")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const grouped = useMemo(() => {
    const byCategory = new Map<PhotographerCategory, Photographer[]>()
    for (const photographer of PHOTOGRAPHERS) {
      if (!matches(photographer.id, photographer.label, photographer.description, query)) {
        continue
      }
      const list = byCategory.get(photographer.category) ?? []
      list.push(photographer)
      byCategory.set(photographer.category, list)
    }
    return PHOTOGRAPHER_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      photographers: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.photographers.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search photographer"
          placeholder="Search photographer"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No photographer matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, photographers }) => {
        if (photographers.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {PHOTOGRAPHER_CATEGORY_LABELS[category]}
            </div>
            <div
              role="radiogroup"
              aria-label={PHOTOGRAPHER_CATEGORY_LABELS[category]}
              className="grid grid-cols-2 gap-1.5"
            >
              {photographers.map((photographer) => {
                const selectedIdx = selectedIds.indexOf(photographer.id)
                const selected = selectedIdx >= 0
                const label = resolveLabel(photographer.id, photographer.label)
                const description = resolveDescription(photographer.id, photographer.description)
                return (
                  <div key={photographer.id} className="relative">
                    <button
                      type="button"
                      role={maxSelected > 1 ? "checkbox" : "radio"}
                      aria-checked={selected}
                      title={description}
                      onClick={() => handlePick(photographer.id)}
                      className={cn(
                        "w-full flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                        selected
                          ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                          : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                      )}
                    >
                      <FitText
                        text={label}
                        className={cn(
                          "text-[11px] font-semibold leading-tight w-full",
                          selected ? "text-[#ff0073]" : "text-gray-800 dark:text-[#E2E8F0]",
                        )}
                      />
                      <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2 w-full">
                        {description}
                      </span>
                    </button>
                    {selected && (
                      <MultiPickBadge
                        mode={isMulti ? "multi" : "single"}
                        index={selectedIdx}
                        maxSelected={maxSelected}
                        onActivate={() => activateMulti(photographer.id)}
                        onDemote={() => demoteToSingle(photographer.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  BACKDROPS,
  BACKDROP_CATEGORY_LABELS,
  BACKDROP_CATEGORY_ORDER,
  type Backdrop,
  type BackdropCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { BackdropSwatch } from "./backdrop-swatch"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface BackdropPickerProps {
  readonly value: string
  readonly onValueChange: (backdropId: string) => void
  readonly className?: string
}

/**
 * Single-select Backdrop picker. Backdrops are grouped by category
 * (Solid, Gradient, Textured, Fabric, Effect, Reflective). Each tile
 * shows a small CSS swatch preview to make color/effect picking visual.
 */
export const BackdropPicker = memo(function BackdropPicker({
  value,
  onValueChange,
  className,
}: BackdropPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("backdrop")

  const grouped = useMemo(() => {
    const byCategory = new Map<BackdropCategory, Backdrop[]>()
    for (const b of BACKDROPS) {
      if (!matches(b.id, b.label, b.description, query)) {
        continue
      }
      const list = byCategory.get(b.category) ?? []
      list.push(b)
      byCategory.set(b.category, list)
    }
    return BACKDROP_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      backdrops: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.backdrops.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search backdrop"
          placeholder="Search backdrop"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No backdrop matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, backdrops }) => {
        if (backdrops.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {BACKDROP_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={BACKDROP_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {backdrops.map((b) => {
                const selected = b.id === value
                const label = resolveLabel(b.id, b.label)
                const description = resolveDescription(b.id, b.description)
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(b.id)}
                    className={cn(
                      "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <BackdropSwatch backdropId={b.id} className="w-full aspect-square" />
                    <FitText
                      text={label}
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center",
                        selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

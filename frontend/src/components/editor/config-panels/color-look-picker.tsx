"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  COLOR_LOOKS,
  COLOR_LOOK_CATEGORY_ORDER,
  COLOR_LOOK_CATEGORY_LABELS,
  type ColorLook,
  type ColorLookCategory,
} from "@nodaro-shared/color-look"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { ColorLookPreview } from "./color-look-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface ColorLookPickerProps {
  readonly value: string
  readonly onValueChange: (colorLookId: string) => void
  readonly className?: string
}

export const ColorLookPicker = memo(function ColorLookPicker({
  value,
  onValueChange,
  className,
}: ColorLookPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("color-look")

  const grouped = useMemo(() => {
    const byCategory = new Map<ColorLookCategory, ColorLook[]>()
    for (const colorLook of COLOR_LOOKS) {
      if (!matches(colorLook.id, colorLook.label, colorLook.description, query)) {
        continue
      }
      const list = byCategory.get(colorLook.category) ?? []
      list.push(colorLook)
      byCategory.set(colorLook.category, list)
    }
    return COLOR_LOOK_CATEGORY_ORDER
      .map((cat) => ({ category: cat, colorLooks: byCategory.get(cat) ?? [] }))
      .filter((section) => section.colorLooks.length > 0)
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search color/look"
          placeholder="Search color/look"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {grouped.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No color/look matches "{query}"
        </div>
      )}

      {grouped.map(({ category, colorLooks }) => (
        <div key={category} className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
            {COLOR_LOOK_CATEGORY_LABELS[category]}
          </div>
          <div role="radiogroup" aria-label={COLOR_LOOK_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
            {colorLooks.map((colorLook) => {
              const selected = colorLook.id === value
              const label = resolveLabel(colorLook.id, colorLook.label)
              const description = resolveDescription(colorLook.id, colorLook.description)
              return (
                <button
                  key={colorLook.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={description}
                  onClick={() => onValueChange(colorLook.id)}
                  className={cn(
                    "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                    selected
                      ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                      : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                  )}
                >
                  <ColorLookPreview colorLookId={colorLook.id} className="w-full aspect-square" />
                  <FitText
                    text={label}
                    className={cn(
                      "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center",
                      selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                    )}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
})

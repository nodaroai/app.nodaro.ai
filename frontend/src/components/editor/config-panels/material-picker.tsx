"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  MATERIALS,
  MATERIAL_CATEGORY_LABELS,
  MATERIAL_CATEGORY_ORDER,
  type Material,
  type MaterialCategory,
} from "@nodaro/shared"
import { pickIds, togglePick } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { MaterialPreview } from "./material-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface MaterialPickerProps {
  readonly value: string | ReadonlyArray<string>
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

/**
 * Single-select material picker: user picks ONE material from the catalog,
 * grouped by category (Fabric / Metal / Stone / Wood / Glass / Natural /
 * Exotic). Search filters across label + description.
 */
export const MaterialPicker = memo(function MaterialPicker({
  value,
  onValueChange,
  className,
  maxSelected = 1,
}: MaterialPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("materials")
  const selectedIds = useMemo(() => pickIds(value), [value])

  const handlePick = (id: string) => {
    if (maxSelected <= 1) {
      onValueChange(selectedIds[0] === id ? undefined : id)
      return
    }
    const next = togglePick(selectedIds, id, maxSelected)
    if (next.length === 0) onValueChange(undefined)
    else if (next.length === 1) onValueChange(next[0])
    else onValueChange(next)
  }

  const grouped = useMemo(() => {
    const byCategory = new Map<MaterialCategory, Material[]>()
    for (const material of MATERIALS) {
      if (!matches(material.id, material.label, material.description, query)) {
        continue
      }
      const list = byCategory.get(material.category) ?? []
      list.push(material)
      byCategory.set(material.category, list)
    }
    return MATERIAL_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      materials: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.materials.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search material"
          placeholder="Search material"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No material matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, materials }) => {
        if (materials.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {MATERIAL_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={MATERIAL_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {materials.map((material) => {
                const selectedIdx = selectedIds.indexOf(material.id)
                const selected = selectedIdx >= 0
                const label = resolveLabel(material.id, material.label)
                const description = resolveDescription(material.id, material.description)
                return (
                  <button
                    key={material.id}
                    type="button"
                    role={maxSelected > 1 ? "checkbox" : "radio"}
                    aria-checked={selected}
                    title={description}
                    onClick={() => handlePick(material.id)}
                    className={cn(
                      "relative group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    {maxSelected > 1 && selected && (
                      <span
                        className="absolute top-1 right-1 size-4 rounded-full bg-[#ff0073] text-white text-[9px] font-semibold flex items-center justify-center pointer-events-none z-10"
                        aria-hidden="true"
                      >
                        {selectedIdx + 1}
                      </span>
                    )}
                    <MaterialPreview materialId={material.id} className="w-full aspect-square" />
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
        )
      })}
    </div>
  )
})

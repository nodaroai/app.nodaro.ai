"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { MATERIALS as BASE_MATERIALS, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER, type Material, type MaterialCategory } from "@nodaro/prompts"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { MaterialPreview } from "../previews/material-preview"
import { useLocalizedCatalog } from "../i18n"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"
import { useCuratedEntries } from "../curated.js"
import { CharacterArtTile, characterArtGridClass } from "./character-art-tile"

interface MaterialPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
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
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const MATERIALS = useCuratedEntries("materials", BASE_MATERIALS)
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("materials")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

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
    <div className={cn("flex flex-col gap-3 @container", className)}>
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
          <div key={category} className="flex flex-col gap-1.5 mt-5 pt-5 border-t-[3px] border-border/40">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {MATERIAL_CATEGORY_LABELS[category]}
            </div>
            <div role={maxSelected > 1 ? "group" : "radiogroup"} aria-label={MATERIAL_CATEGORY_LABELS[category]} className={characterArtGridClass("square")}>
              {materials.map((material) => {
                const selectedIdx = selectedIds.indexOf(material.id)
                const selected = selectedIdx >= 0
                return (
                  <CharacterArtTile
                    key={material.id}
                    family="materials"
                    id={material.id}
                    shape="square"
                    label={resolveLabel(material.id, material.label)}
                    title={resolveDescription(material.id, material.description)}
                    selected={selected}
                    multi={maxSelected > 1}
                    onPick={() => handlePick(material.id)}
                    fallback={<MaterialPreview materialId={material.id} className="size-full" />}
                    badge={
                      selected && maxSelected > 1 ? (
                        <MultiPickBadge
                          mode={isMulti ? "multi" : "single"}
                          index={selectedIdx}
                          maxSelected={maxSelected}
                          onActivate={() => activateMulti(material.id)}
                          onDemote={() => demoteToSingle(material.id)}
                          className={cn("top-[5px] right-[5px]", !isMulti && "bg-white dark:bg-[#111114]")}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

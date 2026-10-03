"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { ANIMALS as BASE_ANIMALS, ANIMAL_SUBCATEGORY_LABELS, ANIMAL_SUBCATEGORY_ORDER, type Animal, type AnimalSubcategory } from "@nodaro/shared"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { ANIMAL_ICON_FOR } from "../icons/parameter-picker-icons-animals"
import { useCuratedEntries } from "../curated.js"
import { CharacterArtTile, characterArtGridClass } from "./character-art-tile"

interface AnimalPickerProps {
  readonly value: string
  readonly onValueChange: (animalId: string, animal: Animal) => void
  readonly className?: string
}

/**
 * Single-select animal picker. Animals are grouped by sub-category
 * (cats, dogs, transport, farm, wild, birds, sea, small pets, reptiles,
 * mythical). Search filters across label + description.
 *
 * Selecting an animal calls `onValueChange(id, animal)` so the caller can
 * auto-fill dependent fields (objectName, description) from the catalog.
 */
export const AnimalPicker = memo(function AnimalPicker({
  value,
  onValueChange,
  className,
}: AnimalPickerProps) {
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const ANIMALS = useCuratedEntries("animals", BASE_ANIMALS)
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("animals")

  const grouped = useMemo(() => {
    const byCategory = new Map<AnimalSubcategory, Animal[]>()
    for (const animal of ANIMALS) {
      if (!matches(animal.id, animal.label, animal.description, query)) {
        continue
      }
      const list = byCategory.get(animal.subcategory) ?? []
      list.push(animal)
      byCategory.set(animal.subcategory, list)
    }
    return ANIMAL_SUBCATEGORY_ORDER.map((cat) => ({
      subcategory: cat,
      animals: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.animals.length > 0)

  return (
    <div className={cn("flex flex-col gap-3 @container", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search animal"
          placeholder="Search animal"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No animal matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ subcategory, animals }) => {
        if (animals.length === 0) return null
        return (
          <div key={subcategory} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {ANIMAL_SUBCATEGORY_LABELS[subcategory]}
            </div>
            <div
              role="radiogroup"
              aria-label={ANIMAL_SUBCATEGORY_LABELS[subcategory]}
              className={characterArtGridClass("square")}
            >
              {animals.map((animal) => (
                <CharacterArtTile
                  key={animal.id}
                  family="animals"
                  id={animal.id}
                  shape="square"
                  label={resolveLabel(animal.id, animal.label)}
                  title={resolveDescription(animal.id, animal.description)}
                  selected={animal.id === value}
                  multi={false}
                  onPick={() => onValueChange(animal.id, animal)}
                  fallback={
                    <span className="text-4xl leading-none select-none">{ANIMAL_ICON_FOR(animal.id)}</span>
                  }
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
})

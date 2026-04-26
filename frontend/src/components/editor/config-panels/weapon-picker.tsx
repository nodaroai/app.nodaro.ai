"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  WEAPONS,
  WEAPON_SUBCATEGORY_LABELS,
  WEAPON_SUBCATEGORY_ORDER,
  type Weapon,
  type WeaponSubcategory,
} from "@nodaro-shared/weapons"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { WEAPON_ICON_FOR } from "@/lib/parameter-picker-icons-weapons"

interface WeaponPickerProps {
  readonly value: string
  readonly onValueChange: (weaponId: string, weapon: Weapon) => void
  readonly className?: string
}

/**
 * Single-select weapon picker. Weapons are grouped by family (swords,
 * daggers, axes, polearms, bows, blunt, throwing, firearms modern,
 * firearms historical, explosives & siege, sci-fi, fantasy). Search filters
 * across label + description.
 *
 * Selecting a weapon calls `onValueChange(id, weapon)` so the caller can
 * auto-fill dependent fields (objectName, description) from the catalog.
 */
export const WeaponPicker = memo(function WeaponPicker({
  value,
  onValueChange,
  className,
}: WeaponPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("weapons")

  const grouped = useMemo(() => {
    const byCategory = new Map<WeaponSubcategory, Weapon[]>()
    for (const weapon of WEAPONS) {
      if (!matches(weapon.id, weapon.label, weapon.description, query)) {
        continue
      }
      const list = byCategory.get(weapon.subcategory) ?? []
      list.push(weapon)
      byCategory.set(weapon.subcategory, list)
    }
    return WEAPON_SUBCATEGORY_ORDER.map((cat) => ({
      subcategory: cat,
      weapons: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.weapons.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search weapon"
          placeholder="Search weapon"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No weapon matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ subcategory, weapons }) => {
        if (weapons.length === 0) return null
        return (
          <div key={subcategory} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {WEAPON_SUBCATEGORY_LABELS[subcategory]}
            </div>
            <div
              role="radiogroup"
              aria-label={WEAPON_SUBCATEGORY_LABELS[subcategory]}
              className="grid grid-cols-3 gap-1.5"
            >
              {weapons.map((weapon) => {
                const selected = weapon.id === value
                const label = resolveLabel(weapon.id, weapon.label)
                const description = resolveDescription(weapon.id, weapon.description)
                return (
                  <button
                    key={weapon.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(weapon.id, weapon)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {WEAPON_ICON_FOR(weapon.id)}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-0.5 pb-0.5 text-center line-clamp-2",
                        selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {label}
                    </span>
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

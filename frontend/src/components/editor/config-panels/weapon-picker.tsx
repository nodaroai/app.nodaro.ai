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

interface WeaponPickerProps {
  readonly value: string
  readonly onValueChange: (weaponId: string, weapon: Weapon) => void
  readonly className?: string
}

const WEAPON_EMOJI: Record<string, string> = {
  // swords
  katana: "⚔️", longsword: "⚔️", broadsword: "⚔️", rapier: "🤺",
  saber: "⚔️", scimitar: "⚔️", claymore: "⚔️", cutlass: "🏴‍☠️",
  wakizashi: "⚔️", falchion: "⚔️",
  // daggers
  dagger: "🗡️", "bowie-knife": "🔪", kukri: "🗡️", stiletto: "🗡️",
  dirk: "🗡️", tanto: "🗡️", switchblade: "🔪", "trench-knife": "🗡️",
  // axes
  "battle-axe": "🪓", tomahawk: "🪓", hatchet: "🪓", halberd: "🪓",
  greataxe: "🪓", "bearded-axe": "🪓",
  // polearms
  spear: "🔱", lance: "🔱", pike: "🔱", glaive: "🔱", trident: "🔱", naginata: "🔱",
  // bows
  longbow: "🏹", "recurve-bow": "🏹", "compound-bow": "🏹",
  crossbow: "🏹", "short-bow": "🏹",
  // blunt
  mace: "🔨", "war-hammer": "🔨", club: "🏏", "morning-star": "🔨",
  flail: "⛓️", nunchaku: "🥋",
  // throwing
  shuriken: "⭐", "throwing-knife": "🗡️", boomerang: "🪃",
  javelin: "🔱", bolas: "⚪",
  // modern firearms
  pistol: "🔫", revolver: "🔫", "assault-rifle": "🔫", shotgun: "🔫",
  smg: "🔫", "sniper-rifle": "🔫", "machine-gun": "🔫",
  // historical firearms
  musket: "🔫", "flintlock-pistol": "🔫", blunderbuss: "🔫", "dueling-pistol": "🔫",
  // explosives & siege
  grenade: "💣", "stick-grenade": "💣", dynamite: "🧨", bomb: "💣",
  "rocket-launcher": "🚀", cannon: "💥", catapult: "🏰", trebuchet: "🏰",
  // sci-fi
  "laser-pistol": "🔫", "plasma-rifle": "🔫", lightsaber: "⚔️",
  blaster: "🔫", phaser: "🔫", "rail-gun": "🔫", "emp-grenade": "💣",
  // fantasy
  "enchanted-sword": "⚔️", "magic-staff": "🪄", "runed-dagger": "🗡️",
  "wizard-wand": "🪄", "war-horn": "📯", "sorcerer-orb": "🔮",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<WeaponSubcategory, string> = {
  swords: "⚔️",
  daggers: "🗡️",
  axes: "🪓",
  polearms: "🔱",
  bows: "🏹",
  blunt: "🔨",
  throwing: "🎯",
  "firearms-modern": "🔫",
  "firearms-historical": "🔫",
  "explosives-siege": "💣",
  "sci-fi": "🔫",
  fantasy: "🪄",
}

function emojiFor(weapon: Weapon): string {
  return WEAPON_EMOJI[weapon.id] ?? SUBCATEGORY_FALLBACK_EMOJI[weapon.subcategory]
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

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<WeaponSubcategory, Weapon[]>()
    for (const weapon of WEAPONS) {
      if (q && !weapon.label.toLowerCase().includes(q) && !weapon.description.toLowerCase().includes(q)) {
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
  }, [query])

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
                return (
                  <button
                    key={weapon.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={weapon.description}
                    onClick={() => onValueChange(weapon.id, weapon)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {emojiFor(weapon)}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-0.5 pb-0.5 text-center line-clamp-2",
                        selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {weapon.label}
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

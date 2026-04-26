"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  FURNITURE,
  FURNITURE_SUBCATEGORY_LABELS,
  FURNITURE_SUBCATEGORY_ORDER,
  type Furniture,
  type FurnitureSubcategory,
} from "@nodaro-shared/furniture"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface FurniturePickerProps {
  readonly value: string
  readonly onValueChange: (furnitureId: string, furniture: Furniture) => void
  readonly className?: string
}

const FURNITURE_EMOJI: Record<string, string> = {
  // seating
  sofa: "🛋️", "sectional-sofa": "🛋️", loveseat: "🛋️", armchair: "🪑",
  recliner: "🛋️", "office-chair": "🪑", "rocking-chair": "🪑", throne: "👑",
  "bean-bag": "🪑", stool: "🪑", bench: "🪑", "chaise-lounge": "🛋️", "dining-chair": "🪑",
  // tables
  "dining-table": "🍽️", "coffee-table": "☕", "side-table": "🪑",
  "console-table": "🪑", desk: "🪑", workbench: "🔨", "vanity-table": "🪞",
  nightstand: "🛏️", "picnic-table": "🧺",
  // beds
  "bed-single": "🛏️", "bed-queen": "🛏️", "bed-king": "🛏️",
  "bunk-bed": "🛏️", "canopy-bed": "🛏️", "four-poster-bed": "🛏️",
  daybed: "🛏️", crib: "🍼", futon: "🛏️", hammock: "🌴",
  // storage
  bookshelf: "📚", wardrobe: "🚪", dresser: "🗄️", cabinet: "🗄️",
  chest: "🧰", trunk: "🧳", "filing-cabinet": "🗄️", "tv-stand": "📺",
  "display-case": "🏺", hutch: "🍽️", "toy-chest": "🧸",
  // lighting
  "floor-lamp": "💡", "table-lamp": "💡", "desk-lamp": "💡",
  chandelier: "✨", "pendant-light": "💡", sconce: "🕯️",
  lantern: "🏮", candelabra: "🕯️", "neon-sign": "💡",
  // kitchen
  "kitchen-island": "🍳", "bar-counter": "🍸", "bar-stool": "🪑",
  "pot-rack": "🍳", "spice-rack": "🧂", buffet: "🍽️",
  // outdoor
  "patio-chair": "🪑", "adirondack-chair": "🪑", "porch-swing": "🪑",
  gazebo: "🏡", "bistro-set": "☕", "sun-lounger": "🏖️", "fire-pit": "🔥",
  // decorative
  mirror: "🪞", rug: "🧺", vase: "🏺", "grandfather-clock": "🕰️",
  "wall-art": "🖼️", pillow: "🛏️", curtains: "🪟", sculpture: "🗿",
  // bath
  bathtub: "🛁", shower: "🚿", toilet: "🚽", "sink-vanity": "🪞", "towel-rack": "🧺",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<FurnitureSubcategory, string> = {
  seating: "🪑",
  tables: "🪑",
  beds: "🛏️",
  storage: "🗄️",
  lighting: "💡",
  "kitchen-dining": "🍽️",
  outdoor: "🏡",
  decorative: "🖼️",
  bath: "🛁",
}

function emojiFor(furniture: Furniture): string {
  return FURNITURE_EMOJI[furniture.id] ?? SUBCATEGORY_FALLBACK_EMOJI[furniture.subcategory]
}

/**
 * Single-select furniture picker. Furniture pieces are grouped by
 * sub-category (seating, tables, beds, storage, lighting, kitchen & dining,
 * outdoor, decorative, bath). Search filters across label + description.
 *
 * Selecting a piece calls `onValueChange(id, furniture)` so the caller can
 * auto-fill dependent fields (objectName, description) from the catalog.
 */
export const FurniturePicker = memo(function FurniturePicker({
  value,
  onValueChange,
  className,
}: FurniturePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("furniture")

  const grouped = useMemo(() => {
    const byCategory = new Map<FurnitureSubcategory, Furniture[]>()
    for (const piece of FURNITURE) {
      if (!matches(piece.id, piece.label, piece.description, query)) {
        continue
      }
      const list = byCategory.get(piece.subcategory) ?? []
      list.push(piece)
      byCategory.set(piece.subcategory, list)
    }
    return FURNITURE_SUBCATEGORY_ORDER.map((cat) => ({
      subcategory: cat,
      pieces: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.pieces.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search furniture"
          placeholder="Search furniture"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No furniture matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ subcategory, pieces }) => {
        if (pieces.length === 0) return null
        return (
          <div key={subcategory} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {FURNITURE_SUBCATEGORY_LABELS[subcategory]}
            </div>
            <div
              role="radiogroup"
              aria-label={FURNITURE_SUBCATEGORY_LABELS[subcategory]}
              className="grid grid-cols-3 gap-1.5"
            >
              {pieces.map((piece) => {
                const selected = piece.id === value
                const label = resolveLabel(piece.id, piece.label)
                const description = resolveDescription(piece.id, piece.description)
                return (
                  <button
                    key={piece.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(piece.id, piece)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {emojiFor(piece)}
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

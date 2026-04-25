"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  HELD_PROPS,
  HELD_PROP_CATEGORY_LABELS,
  HELD_PROP_CATEGORY_ORDER,
  type HeldProp,
  type HeldPropCategory,
} from "@nodaro-shared/held-prop"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface HeldPropPickerProps {
  readonly value: string
  readonly onValueChange: (heldPropId: string) => void
  readonly className?: string
}

/**
 * Per-prop emoji map keeps the picker visual without bundling image
 * assets. Falls back to a per-category emoji when an id is missing.
 */
const HELD_PROP_EMOJI: Record<string, string> = {
  // device
  smartphone: "📱", "smartphone-raised": "📱", "polaroid-camera": "📷",
  "vintage-camera": "📷", "dslr-camera": "📸", "video-camera": "📹",
  microphone: "🎤", megaphone: "📢", smartwatch: "⌚",
  // drink
  "coffee-cup": "☕", "takeaway-coffee": "🥤", "wine-glass": "🍷",
  "champagne-flute": "🥂", "martini-glass": "🍸", "cocktail-glass": "🥃",
  "beer-bottle": "🍺", "water-bottle": "💧",
  // smoking
  cigarette: "🚬", cigar: "🚬", "vape-pen": "💨", joint: "🌿",
  // reading-writing
  book: "📖", magazine: "📰", newspaper: "🗞️", notebook: "📓",
  pen: "🖊️", marker: "🖍️", paintbrush: "🖌️", chalk: "✏️",
  // bag-accessory
  handbag: "👜", "tote-bag": "👜", briefcase: "💼",
  umbrella: "☂️", "fan-folding": "🪭",
  // floral-nature
  bouquet: "💐", "single-rose": "🌹", sunflower: "🌻",
  leaf: "🍃", "fruit-apple": "🍎",
  // instrument
  guitar: "🎸", violin: "🎻", saxophone: "🎷",
  drumsticks: "🥁", "sheet-music": "🎼",
  // companion
  "small-dog": "🐶", cat: "🐱", "plush-toy": "🧸",
  // occupational
  katana: "🗡️", "pointer-stick": "📏", gavel: "⚖️", "wine-bottle": "🍾",
}

const SUBCATEGORY_FALLBACK_EMOJI: Record<HeldPropCategory, string> = {
  device: "📱",
  drink: "☕",
  smoking: "🚬",
  "reading-writing": "📖",
  "bag-accessory": "👜",
  "floral-nature": "🌹",
  instrument: "🎸",
  companion: "🐶",
  occupational: "🗡️",
}

function emojiFor(prop: HeldProp): string {
  return HELD_PROP_EMOJI[prop.id] ?? SUBCATEGORY_FALLBACK_EMOJI[prop.category]
}

/**
 * Single-select Held Prop picker. Props are grouped by category
 * (Devices, Drinks, Smoking, Reading/Writing, Bags/Accessories,
 * Floral, Instruments, Companions, Occupational). Search filters
 * across label + description.
 */
export const HeldPropPicker = memo(function HeldPropPicker({
  value,
  onValueChange,
  className,
}: HeldPropPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<HeldPropCategory, HeldProp[]>()
    for (const prop of HELD_PROPS) {
      if (q && !prop.label.toLowerCase().includes(q) && !prop.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(prop.category) ?? []
      list.push(prop)
      byCategory.set(prop.category, list)
    }
    return HELD_PROP_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      props: byCategory.get(cat) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.props.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search held prop"
          placeholder="Search held prop"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No prop matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, props }) => {
        if (props.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {HELD_PROP_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={HELD_PROP_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {props.map((prop) => {
                const selected = prop.id === value
                return (
                  <button
                    key={prop.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={prop.description}
                    onClick={() => onValueChange(prop.id)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {emojiFor(prop)}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-0.5 pb-0.5 text-center line-clamp-2",
                        selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {prop.label}
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

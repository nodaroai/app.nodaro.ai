"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  HELD_PROPS,
  HELD_PROP_CATEGORY_LABELS,
  HELD_PROP_CATEGORY_ORDER,
  type HeldProp,
  type HeldPropCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface HeldPropPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
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
  maxSelected = 1,
}: HeldPropPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("held-prop")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const grouped = useMemo(() => {
    const byCategory = new Map<HeldPropCategory, HeldProp[]>()
    for (const prop of HELD_PROPS) {
      if (!matches(prop.id, prop.label, prop.description, query)) {
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
  }, [query, matches])

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
          <div key={category} className="flex flex-col gap-1.5 mt-5 pt-5 border-t-[3px] border-border/40">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {HELD_PROP_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={HELD_PROP_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {props.map((prop) => {
                const selectedIdx = selectedIds.indexOf(prop.id)
                const selected = selectedIdx >= 0
                const label = resolveLabel(prop.id, prop.label)
                const description = resolveDescription(prop.id, prop.description)
                return (
                  <div key={prop.id} className="relative">
                    <button
                      type="button"
                      role={maxSelected > 1 ? "checkbox" : "radio"}
                      aria-checked={selected}
                      title={description}
                      onClick={() => handlePick(prop.id)}
                      className={cn(
                        "w-full group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
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
                        {label}
                      </span>
                    </button>
                    {selected && (
                      <MultiPickBadge
                        mode={isMulti ? "multi" : "single"}
                        index={selectedIdx}
                        maxSelected={maxSelected}
                        onActivate={() => activateMulti(prop.id)}
                        onDemote={() => demoteToSingle(prop.id)}
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

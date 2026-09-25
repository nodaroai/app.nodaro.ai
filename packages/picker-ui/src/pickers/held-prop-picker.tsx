"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { HELD_PROPS as BASE_HELD_PROPS, HELD_PROP_CATEGORY_LABELS, HELD_PROP_CATEGORY_ORDER, type HeldProp, type HeldPropCategory } from "@nodaro/prompts"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"
import { useCuratedEntries } from "../curated.js"
import { CharacterArtTile, characterArtGridClass } from "./character-art-tile"

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
  smartphone: "📱", "smartphone-raised": "📱🤳", "polaroid-camera": "📷",
  "vintage-camera": "📷🎞️", "dslr-camera": "📸", "video-camera": "📹",
  microphone: "🎤", megaphone: "📢", smartwatch: "⌚",
  // drink
  "coffee-cup": "☕", "takeaway-coffee": "🥤", "wine-glass": "🍷",
  "champagne-flute": "🥂", "martini-glass": "🍸", "cocktail-glass": "🥃",
  "beer-bottle": "🍺", "water-bottle": "💧",
  // smoking
  cigarette: "🚬", cigar: "🚬💼", "vape-pen": "💨", joint: "🌿",
  // reading-writing
  book: "📖", magazine: "📰", newspaper: "🗞️", notebook: "📓",
  pen: "🖊️", marker: "🖍️", paintbrush: "🖌️", chalk: "✏️",
  // bag-accessory
  handbag: "👜", "tote-bag": "🛍️", briefcase: "💼",
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
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const HELD_PROPS = useCuratedEntries("held-prop", BASE_HELD_PROPS)
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
    <div className={cn("flex flex-col gap-3 @container", className)}>
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
            <div role={maxSelected > 1 ? "group" : "radiogroup"} aria-label={HELD_PROP_CATEGORY_LABELS[category]} className={characterArtGridClass("square")}>
              {props.map((prop) => {
                const selectedIdx = selectedIds.indexOf(prop.id)
                const selected = selectedIdx >= 0
                return (
                  <CharacterArtTile
                    key={prop.id}
                    family="held-prop"
                    id={prop.id}
                    shape="square"
                    label={resolveLabel(prop.id, prop.label)}
                    title={resolveDescription(prop.id, prop.description)}
                    selected={selected}
                    multi={maxSelected > 1}
                    onPick={() => handlePick(prop.id)}
                    fallback={<span className="text-4xl leading-none select-none">{emojiFor(prop)}</span>}
                    badge={
                      selected && maxSelected > 1 ? (
                        <MultiPickBadge
                          mode={isMulti ? "multi" : "single"}
                          index={selectedIdx}
                          maxSelected={maxSelected}
                          onActivate={() => activateMulti(prop.id)}
                          onDemote={() => demoteToSingle(prop.id)}
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

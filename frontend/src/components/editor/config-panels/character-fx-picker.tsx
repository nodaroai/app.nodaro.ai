"use client"

import { memo, useMemo, useState, type ReactNode } from "react"
import {
  Search,
  Dog,
  Skull,
  Bot,
  Ghost,
  Building,
  Droplet,
  Squirrel,
  Cloud,
  Diamond,
  Flame,
  Snowflake,
  Wind,
  Waves,
  Mountain,
  Zap,
  ArrowUpFromLine,
  Wand2,
  EyeOff,
  Eye,
  Bird,
  Bug,
  Drama,
  Flower2,
  Camera,
  DollarSign,
  Palette,
  Sun,
  Moon,
  Star,
  Sparkles,
  Shield,
} from "lucide-react"
import {
  CHARACTER_FX,
  CHARACTER_FX_CATEGORY_LABELS,
  CHARACTER_FX_CATEGORY_ORDER,
  type CharacterFx,
  type CharacterFxCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

// 57 entries — lucide icons matched to each effect. Fallback: <Sparkles />
const CHARACTER_FX_ICONS: Record<string, ReactNode> = {
  // transformation
  werewolf: <Dog />,
  vampire: <Skull />,
  cyborg: <Bot />,
  "ghost-form": <Ghost />,
  "statue-stone": <Building />,
  "liquid-metal": <Droplet />,
  animalization: <Squirrel />,
  "gorilla-form": <Squirrel />,
  mystification: <Wand2 />,
  "gas-form": <Cloud />,
  "diamond-skin": <Diamond />,
  "agent-reveal": <Shield />,
  // power
  "fire-breathe": <Flame />,
  "ice-breathe": <Snowflake />,
  "air-bending": <Wind />,
  "water-bending": <Waves />,
  "earth-bending": <Mountain />,
  "lightning-hands": <Zap />,
  levitation: <ArrowUpFromLine />,
  telekinesis: <Wand2 />,
  invisibility: <EyeOff />,
  "hero-flight": <Bird />,
  "super-speed": <Zap />,
  "soul-departure": <Ghost />,
  // body-mod
  "wings-grow": <Bird />,
  "horns-grow": <Mountain />,
  "tail-emerge": <Squirrel />,
  "tentacles-emerge": <Bug />,
  "extra-eyes": <Eye />,
  "head-explode": <Flame />,
  "head-off": <Skull />,
  "spiders-from-mouth": <Bug />,
  "skin-surge": <Waves />,
  // face-expression
  "horror-face": <Drama />,
  "oni-mask": <Drama />,
  "glowing-eyes": <Eye />,
  "floral-eyes": <Flower2 />,
  "bloom-mouth": <Flower2 />,
  "x-ray": <Eye />,
  "agent-snap": <Shield />,
  "visor-x": <Shield />,
  // aura-ambient
  paparazzi: <Camera />,
  "money-rain": <DollarSign />,
  "color-rain": <Palette />,
  "saint-glow": <Sun />,
  "fire-aura": <Flame />,
  "frost-aura": <Snowflake />,
  "shadow-aura": <Moon />,
  "electricity-aura": <Zap />,
  "sparkles-around": <Sparkles />,
  "fairies-around": <Star />,
  "objects-orbit": <Diamond />,
  "petals-around": <Flower2 />,
  "glow-trace": <Sparkles />,
  "tattoo-animation": <Wand2 />,
  // generic fallback entries for any unlisted ids
  default: <Sparkles />,
}

function getCharacterFxIcon(id: string): ReactNode {
  return CHARACTER_FX_ICONS[id] ?? <Sparkles />
}

interface CharacterFxPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

/**
 * Multi-pick Character FX picker (1–2 ids → composite character-fx clause).
 *
 * Catalog of 57 character effects grouped into 5 categories (transformation,
 * power, body-mod, face-expression, aura-ambient). Tabs surface each category
 * in a 2-col grid; search flattens across categories when non-empty.
 *
 * Each tile renders a per-entry lucide icon + label + 2-line description in a
 * flex-row layout. Mirrors the TransitionPicker UX: `+` badge promotes
 * single→multi, numbered badge demotes back. 2-cap shared with backend
 * `composeCharacterFxHintFromConnections()`.
 */
export const CharacterFxPicker = memo(function CharacterFxPicker({
  value,
  onValueChange,
  className,
  maxSelected = 2,
}: CharacterFxPickerProps) {
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<CharacterFxCategory>("transformation")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("character-fx")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const isSearching = query.trim().length > 0

  const filtered: ReadonlyArray<CharacterFx> = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return CHARACTER_FX
    return CHARACTER_FX.filter((c) => matches(c.id, c.label, c.description, query))
  }, [query, matches])

  const byCategory = useMemo(() => {
    const m = new Map<CharacterFxCategory, CharacterFx[]>()
    for (const cat of CHARACTER_FX_CATEGORY_ORDER) m.set(cat, [])
    for (const c of filtered) m.get(c.category)?.push(c)
    return m
  }, [filtered])

  const selectedCountByCategory = useMemo(() => {
    const m = new Map<CharacterFxCategory, number>()
    for (const cat of CHARACTER_FX_CATEGORY_ORDER) {
      m.set(cat, (byCategory.get(cat) ?? []).filter((c) => selectedIds.includes(c.id)).length)
    }
    return m
  }, [byCategory, selectedIds])

  const renderTile = (c: CharacterFx) => {
    const selectedIdx = selectedIds.indexOf(c.id)
    const selected = selectedIdx >= 0
    const label = resolveLabel(c.id, c.label)
    const description = resolveDescription(c.id, c.description)
    return (
      <div key={c.id} className="relative">
        <button
          type="button"
          role={maxSelected > 1 ? "checkbox" : "radio"}
          aria-checked={selected}
          title={description}
          onClick={() => handlePick(c.id)}
          className={cn(
            "w-full group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
            selected
              ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
              : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
          )}
        >
          <span className="flex items-center gap-1.5 w-full">
            <span
              className={cn(
                "size-4 shrink-0",
                selected ? "text-[#ff0073]" : "text-muted-foreground",
              )}
            >
              {getCharacterFxIcon(c.id)}
            </span>
            <span
              className={cn(
                "text-[11.5px] font-semibold leading-tight",
                selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
              )}
            >
              {label}
            </span>
          </span>
          <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2 pl-5">
            {description}
          </span>
        </button>
        {selected && (
          <MultiPickBadge
            mode={isMulti ? "multi" : "single"}
            index={selectedIdx}
            maxSelected={maxSelected}
            onActivate={() => activateMulti(c.id)}
            onDemote={() => demoteToSingle(c.id)}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search character effects"
          placeholder="Search character effects..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="text-[10px] text-muted-foreground px-0.5">
        {selectedIds.length} / {maxSelected} selected
      </div>

      {isSearching ? (
        <>
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No effects match &quot;{query}&quot;
            </div>
          ) : (
            <div
              role={maxSelected > 1 ? "group" : "radiogroup"}
              aria-label="Character effects (search results)"
              className="grid grid-cols-2 gap-1.5"
            >
              {filtered.map(renderTile)}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label="Character effect categories"
            className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
          >
            {CHARACTER_FX_CATEGORY_ORDER.map((cat) => {
              const active = cat === activeTab
              const count = selectedCountByCategory.get(cat) ?? 0
              const hasPick = count > 0
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(cat)}
                  className={cn(
                    "relative -mb-px inline-flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                    active
                      ? "border-[#ff0073] text-[#ff0073]"
                      : hasPick
                      ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <span>{CHARACTER_FX_CATEGORY_LABELS[cat]}</span>
                  {hasPick && (
                    <span
                      className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[4px] rounded-full bg-[#ff0073] text-white text-[9px] font-semibold leading-none"
                      aria-label={`${count} selected`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            role={maxSelected > 1 ? "group" : "radiogroup"}
            aria-label={CHARACTER_FX_CATEGORY_LABELS[activeTab]}
            className="grid grid-cols-2 gap-1.5"
          >
            {(byCategory.get(activeTab) ?? []).map(renderTile)}
          </div>
        </div>
      )}
    </div>
  )
})

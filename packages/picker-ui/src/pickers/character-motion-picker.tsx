"use client"

import { memo, useMemo, useState, type ReactNode } from "react"
import {
  Search, LogIn, RotateCcw, CircleUserRound, Footprints, Shirt, Music, Smile, Hand, Camera, Swords,
  Dumbbell, ShieldAlert, Armchair, Coffee, Car, PawPrint, Users, Wind, Mic, Ghost,
} from "lucide-react"
import {
  CHARACTER_MOTIONS as BASE_CHARACTER_MOTIONS,
  CHARACTER_MOTION_CATEGORY_LABELS,
  CHARACTER_MOTION_CATEGORY_ORDER,
  CHARACTER_MOTION_MAX_PICKS,
  type CharacterMotion,
  type CharacterMotionCategory,
} from "@nodaro/prompts"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog, usePickerLabel } from "../i18n"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"
import { useCharacterMotionCopy } from "./character-motion-copy"
import { useCuratedEntries } from "../curated.js"

/**
 * One icon per CATEGORY — with ~1054 moves a per-entry icon is noise. A
 * total Record, so adding a category without an icon is a compile error rather
 * than a blank tile.
 */
export const CHARACTER_MOTION_CATEGORY_ICONS: Readonly<Record<CharacterMotionCategory, ReactNode>> = {
  "entrances-exits": <LogIn />,
  "turns-looks": <RotateCcw />,
  "head-gestures": <CircleUserRound />,
  "walks-runs": <Footprints />,
  "runway": <Shirt />,
  "dance": <Music />,
  "face-expression": <Smile />,
  "gestures": <Hand />,
  "camera-interaction": <Camera />,
  "combat-weapons": <Swords />,
  "athletic-stunts": <Dumbbell />,
  "evasive-falls": <ShieldAlert />,
  "posture-shifts": <Armchair />,
  "everyday-actions": <Coffee />,
  "vehicles-mounts": <Car />,
  "animals-pets": <PawPrint />,
  "two-person": <Users />,
  "idle-ambient": <Wind />,
  "stage-performance": <Mic />,
  "unnatural-horror": <Ghost />,
}

interface CharacterMotionPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

/**
 * Ordered multi-pick Character Motion picker (1–3 ids → a "then" sequence).
 *
 * Category tabs over a 2-column tile grid; search flattens across categories.
 * Pick order IS the sequence order, so the picker shows the numbered sequence
 * above the grid. The cap is shared with the composer through
 * `CHARACTER_MOTION_MAX_PICKS`; at the cap a new pick preserves the current sequence.
 */
export const CharacterMotionPicker = memo(function CharacterMotionPicker({
  value,
  onValueChange,
  className,
  maxSelected = CHARACTER_MOTION_MAX_PICKS,
}: CharacterMotionPickerProps) {
  const L = usePickerLabel()
  // Curated view: filtered to ids this deployment offers, relabelled where a
  // pack rewrote an entry. Identity-equal to the base on mainline.
  const CHARACTER_MOTIONS = useCuratedEntries("character-motion", BASE_CHARACTER_MOTIONS)
  const copy = useCharacterMotionCopy()
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState<CharacterMotionCategory>(CHARACTER_MOTION_CATEGORY_ORDER[0]!)
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("character-motion")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const isSearching = query.trim().length > 0

  const filtered: ReadonlyArray<CharacterMotion> = useMemo(() => {
    const available = CHARACTER_MOTIONS.filter(m => !m.deprecated || selectedIds.includes(m.id))
    if (!isSearching) return available
    return available.filter((m) => matches(m.id, m.label, m.description, query) || m.aliases?.some(alias => alias.toLowerCase().includes(query.trim().toLowerCase())))
  }, [CHARACTER_MOTIONS, isSearching, matches, query, selectedIds])

  const byCategory = useMemo(() => {
    const map = new Map<CharacterMotionCategory, CharacterMotion[]>()
    for (const cat of CHARACTER_MOTION_CATEGORY_ORDER) map.set(cat, [])
    for (const m of filtered) map.get(m.category)?.push(m)
    return map
  }, [filtered])

  const selectedCountByCategory = useMemo(() => {
    const map = new Map<CharacterMotionCategory, number>()
    for (const cat of CHARACTER_MOTION_CATEGORY_ORDER) {
      map.set(cat, (byCategory.get(cat) ?? []).filter((m) => selectedIds.includes(m.id)).length)
    }
    return map
  }, [byCategory, selectedIds])

  const byId = useMemo(() => new Map(CHARACTER_MOTIONS.map((m) => [m.id, m])), [CHARACTER_MOTIONS])

  const renderTile = (m: CharacterMotion) => {
    const selectedIdx = selectedIds.indexOf(m.id)
    const selected = selectedIdx >= 0
    const label = resolveLabel(m.id, m.label)
    const description = resolveDescription(m.id, m.description)
    return (
      <div key={m.id} className="relative">
        <button
          type="button"
          role={maxSelected > 1 ? "checkbox" : "radio"}
          aria-checked={selected}
          title={description}
          onClick={() => {
            if (isMulti && !selected && selectedIds.length >= maxSelected) return
            handlePick(m.id)
          }}
          aria-disabled={isMulti && !selected && selectedIds.length >= maxSelected}
          className={cn(
            "w-full group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
            selected
              ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
              : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
          )}
        >
          <span className="flex items-center gap-1.5 w-full">
            <span className={cn("size-4 shrink-0 [&>svg]:size-full", selected ? "text-[#ff0073]" : "text-muted-foreground")}>
              {CHARACTER_MOTION_CATEGORY_ICONS[m.category]}
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
          <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2 pl-5">{description}</span>
        </button>
        {selected && (
          <MultiPickBadge
            mode={isMulti ? "multi" : "single"}
            index={selectedIdx}
            maxSelected={maxSelected}
            onActivate={() => activateMulti(m.id)}
            onDemote={() => demoteToSingle(m.id)}
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
          aria-label="Search character motion"
          placeholder="Search moves..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      <div className="text-[10px] text-muted-foreground px-0.5">
        {selectedIds.length} / {maxSelected} selected
        {isMulti && selectedIds.length >= maxSelected && ` · ${copy("capacity")}`}
      </div>

      {selectedIds.length > 0 && (
        <ol aria-label={copy("sequence")} className="flex flex-wrap items-center gap-1 text-[10px]">
          {selectedIds.map((id, i) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-[#ff0073]/40 bg-[#ff0073]/10 px-2 py-0.5 text-[#ff0073]"
            >
              <span className="font-semibold">{i + 1}</span>
              <span>{resolveLabel(id, byId.get(id)?.label ?? id)}</span>
              {selectedIds.length > 1 && <>
                <button type="button" className="min-h-8 min-w-8 rounded text-sm focus-visible:ring-2 disabled:opacity-30" disabled={i === 0} aria-label={copy("moveUp", resolveLabel(id, byId.get(id)?.label ?? id))} onClick={() => {
                  const next = [...selectedIds]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; onValueChange(next)
                }}>↑</button>
                <button type="button" className="min-h-8 min-w-8 rounded text-sm focus-visible:ring-2 disabled:opacity-30" disabled={i === selectedIds.length - 1} aria-label={copy("moveDown", resolveLabel(id, byId.get(id)?.label ?? id))} onClick={() => {
                  const next = [...selectedIds]; [next[i], next[i + 1]] = [next[i + 1]!, next[i]!]; onValueChange(next)
                }}>↓</button>
              </>}
              <button type="button" className="min-h-8 min-w-8 rounded text-sm focus-visible:ring-2" aria-label={copy("remove", resolveLabel(id, byId.get(id)?.label ?? id))} onClick={() => {
                const next = selectedIds.filter(pick => pick !== id); onValueChange(next.length ? next : undefined)
              }}>×</button>
            </li>
          ))}
        </ol>
      )}

      {isSearching ? (
        filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">No moves match &quot;{query}&quot;</div>
        ) : (
          <div
            role={maxSelected > 1 ? "group" : "radiogroup"}
            aria-label="Character motion (search results)"
            className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          >
            {filtered.map(renderTile)}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="tablist"
            aria-label="Character motion categories"
            className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
          >
            {CHARACTER_MOTION_CATEGORY_ORDER.map((cat) => {
              const active = cat === activeTab
              const count = selectedCountByCategory.get(cat) ?? 0
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
                      : count > 0
                      ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <span>{L(CHARACTER_MOTION_CATEGORY_LABELS[cat])}</span>
                  {count > 0 && (
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
            aria-label={L(CHARACTER_MOTION_CATEGORY_LABELS[activeTab])}
            className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          >
            {(byCategory.get(activeTab) ?? []).map(renderTile)}
          </div>
        </div>
      )}
    </div>
  )
})

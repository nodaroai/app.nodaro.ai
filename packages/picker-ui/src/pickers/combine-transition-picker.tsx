"use client"

import { memo, useEffect, useMemo, useState, type ReactNode } from "react"
import { COMBINE_TRANSITIONS, COMBINE_TRANSITION_GROUP_ORDER, COMBINE_TRANSITION_GROUP_LABELS, getCombineTransition, type CombineTransition, type CombineTransitionGroup } from "@nodaro/shared"
import { cn } from "../lib/cn"
import "../previews/combine-transitions.css"

type TabKey = "common" | CombineTransitionGroup

const TAB_ORDER: ReadonlyArray<TabKey> = ["common", ...COMBINE_TRANSITION_GROUP_ORDER]

/** Every English string the picker renders besides the tile labels — the
 *  host localizes them through `localizeLabel` and its coverage test walks
 *  this list. */
export const COMBINE_TRANSITION_PICKER_CAPTIONS: readonly string[] = ["Common", "Transition category"]

const TAB_LABELS: Record<TabKey, string> = {
  common: "Common",
  ...COMBINE_TRANSITION_GROUP_LABELS,
}

const FADE_OVERLAY_IDS = new Set<string>(["dip-to-black", "dip-to-white", "fadegrays"])

interface CombineTransitionPickerProps {
  readonly value: string
  readonly onChange: (id: string) => void
  /** Localizes an English tile, tab or caption string — the host app's
   *  option-label table. Identity when omitted, so English hosts need nothing. */
  readonly localizeLabel?: (english: string) => string
  /** Offer only these catalog ids (a host that draws a subset, such as Speaker
   *  View's crossfades). A tab with none of them is not drawn, and a value
   *  outside the set opens on the first tab that has a tile. Every id when
   *  omitted — the picker then draws exactly as it always has. */
  readonly allowedIds?: readonly string[]
  /** Tiles drawn in a group above the tabs (the host's own, beside the
   *  catalog's). Nothing is drawn when omitted. */
  readonly leadingTiles?: ReactNode
  /** The group's accessible name, already localized by the host. */
  readonly leadingLabel?: string
}

const identity = (s: string): string => s

/**
 * Tabbed picker for the combine-videos `transition` field.
 *
 * Tabs (underline style, pink active — mirrors person-picker ethnicity tabs):
 * "Common" first (the 10 most-used transitions, also present in their original
 * categories), then one tab per FFmpeg category.
 *
 * Each tile shows a pure-CSS mini-animation looping at 2.4s. Off-tab tiles
 * aren't rendered (only `activeEntries` is mapped), so animation cost stays
 * bounded to the visible tab. Description appears as a `title` tooltip.
 */
export const CombineTransitionPicker = memo(function CombineTransitionPicker({
  value,
  onChange,
  localizeLabel = identity,
  allowedIds,
  leadingTiles,
  leadingLabel,
}: CombineTransitionPickerProps) {
  const byTab = useMemo<Record<TabKey, CombineTransition[]>>(() => {
    const out: Record<TabKey, CombineTransition[]> = {
      common: [],
      fades: [],
      wipes: [],
      slides: [],
      smooth: [],
      shapes: [],
      slices: [],
      reveals: [],
      covers: [],
      effects: [],
    }
    const allowed = allowedIds ? new Set(allowedIds) : null
    for (const t of COMBINE_TRANSITIONS) {
      if (allowed && !allowed.has(t.id)) continue
      if (t.common) out.common.push(t)
      out[t.group].push(t)
    }
    return out
  }, [allowedIds])

  // With every id on offer all tabs are drawn, as before; a subset hides the
  // tabs it leaves empty.
  const tabs = useMemo(() => (allowedIds ? TAB_ORDER.filter((tab) => byTab[tab].length > 0) : TAB_ORDER), [allowedIds, byTab])

  const currentEntry = useMemo(() => getCombineTransition(value), [value])
  const wantedTab: TabKey = currentEntry?.common ? "common" : (currentEntry?.group ?? "common")
  const naturalTab: TabKey = tabs.includes(wantedTab) && (byTab[wantedTab].length > 0 || !allowedIds) ? wantedTab : (tabs[0] ?? "common")

  // Follow the current value's natural tab when it changes externally
  // (workflow load, undo/redo). Manual tab clicks stick until `value` moves.
  const [activeTab, setActiveTab] = useState<TabKey>(naturalTab)
  useEffect(() => {
    setActiveTab(naturalTab)
  }, [naturalTab])

  const activeEntries = byTab[activeTab]

  return (
    <div className="flex flex-col gap-2">
      {leadingTiles && (
        <div role="group" aria-label={leadingLabel} className="grid grid-cols-3 gap-1.5">
          {leadingTiles}
        </div>
      )}
      <div
        role="tablist"
        aria-label={localizeLabel("Transition category")}
        className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
      >
        {tabs.map((tab) => {
          const active = tab === activeTab
          const hasPick = tab === naturalTab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "relative -mb-px inline-flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                active
                  ? "border-[#ff0073] text-[#ff0073]"
                  : hasPick
                    ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
              )}
            >
              <span>{localizeLabel(TAB_LABELS[tab])}</span>
              {hasPick && !active && (
                <span className="inline-block size-1.5 rounded-full bg-[#ff0073]" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      <div
        role="radiogroup"
        aria-label={localizeLabel(TAB_LABELS[activeTab])}
        className="grid grid-cols-3 gap-1.5"
      >
        {activeEntries.map((entry) => (
          <TransitionTile
            key={entry.id}
            entry={entry}
            label={localizeLabel(entry.label)}
            selected={entry.id === value}
            onSelect={() => onChange(entry.id)}
          />
        ))}
      </div>
    </div>
  )
})

/** One transition tile: the catalog's own mini-animation, drawn by the host
 *  as well when it composes the picker with tiles of its own. */
export function TransitionTile({
  entry,
  label,
  selected,
  onSelect,
}: {
  readonly entry: CombineTransition
  readonly label: string
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const isCover = entry.id.startsWith("cover-")
  const overlayId = FADE_OVERLAY_IDS.has(entry.id) ? entry.id : null

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={entry.description}
      onClick={onSelect}
      className="ct-tile"
      data-selected={selected}
    >
      <div className="ct-root">
        <div className="ct-b" />
        {isCover && <div className="ct-cover-bg" />}
        {overlayId && <div className={cn("ct-overlay", `ct-overlay-${overlayId}`)} />}
        <div className={cn("ct-a", `ct-anim-${entry.id}`)} />
      </div>
      <span className="ct-tile-label">{label}</span>
    </button>
  )
}

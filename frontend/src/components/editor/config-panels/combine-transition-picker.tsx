"use client"

import { memo, useEffect, useMemo, useState } from "react"
import {
  COMBINE_TRANSITIONS,
  COMBINE_TRANSITION_GROUP_ORDER,
  COMBINE_TRANSITION_GROUP_LABELS,
  getCombineTransition,
  type CombineTransition,
  type CombineTransitionGroup,
} from "@nodaro/shared"
import { cn } from "@/lib/utils"
import "./combine-transitions.css"

type TabKey = "common" | CombineTransitionGroup

const TAB_ORDER: ReadonlyArray<TabKey> = ["common", ...COMBINE_TRANSITION_GROUP_ORDER]

const TAB_LABELS: Record<TabKey, string> = {
  common: "Common",
  ...COMBINE_TRANSITION_GROUP_LABELS,
}

const FADE_OVERLAY_IDS = new Set<string>(["dip-to-black", "dip-to-white", "fadegrays"])

interface CombineTransitionPickerProps {
  readonly value: string
  readonly onChange: (id: string) => void
}

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
    for (const t of COMBINE_TRANSITIONS) {
      if (t.common) out.common.push(t)
      out[t.group].push(t)
    }
    return out
  }, [])

  const currentEntry = useMemo(() => getCombineTransition(value), [value])
  const naturalTab: TabKey = currentEntry?.common ? "common" : (currentEntry?.group ?? "common")

  // Follow the current value's natural tab when it changes externally
  // (workflow load, undo/redo). Manual tab clicks stick until `value` moves.
  const [activeTab, setActiveTab] = useState<TabKey>(naturalTab)
  useEffect(() => {
    setActiveTab(naturalTab)
  }, [naturalTab])

  const activeEntries = byTab[activeTab]

  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label="Transition category"
        className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
      >
        {TAB_ORDER.map((tab) => {
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
              <span>{TAB_LABELS[tab]}</span>
              {hasPick && !active && (
                <span className="inline-block size-1.5 rounded-full bg-[#ff0073]" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      <div
        role="radiogroup"
        aria-label={`${TAB_LABELS[activeTab]} transitions`}
        className="grid grid-cols-3 gap-1.5"
      >
        {activeEntries.map((entry) => (
          <TransitionTile
            key={entry.id}
            entry={entry}
            selected={entry.id === value}
            onSelect={() => onChange(entry.id)}
          />
        ))}
      </div>
    </div>
  )
})

function TransitionTile({
  entry,
  selected,
  onSelect,
}: {
  readonly entry: CombineTransition
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
      <span className="ct-tile-label">{entry.label}</span>
    </button>
  )
}

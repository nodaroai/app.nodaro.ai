"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  MUSIC_ENERGIES,
  MUSIC_EMOTIONS,
  MUSIC_VIBES,
  type MusicMoodEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"
import { useMultiPick, type MultiPickValue } from "./multi-pick-ui"

export interface MusicMoodValue {
  readonly energy?: string
  readonly emotion?: MultiPickValue
  readonly vibe?: MultiPickValue
}

interface MusicMoodPickerProps {
  readonly value: MusicMoodValue
  readonly onChange: (patch: Partial<MusicMoodValue>) => void
  readonly className?: string
}

interface Section {
  readonly key: keyof MusicMoodValue
  readonly label: string
  readonly entries: ReadonlyArray<MusicMoodEntry>
  readonly maxSelected: number
}

const SECTIONS: ReadonlyArray<Section> = [
  { key: "energy",  label: "Energy",  entries: MUSIC_ENERGIES, maxSelected: 1 },
  { key: "emotion", label: "Emotion", entries: MUSIC_EMOTIONS, maxSelected: 3 },
  { key: "vibe",    label: "Vibe",    entries: MUSIC_VIBES,    maxSelected: 3 },
]

/**
 * Three dimensions: energy (single-select), emotion (up to 3), vibe (up to 3).
 * Multi-pick for emotion/vibe uses the MultiPickBadge tap-to-promote UX.
 */
export const MusicMoodPicker = memo(function MusicMoodPicker({
  value,
  onChange,
  className,
}: MusicMoodPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("music-mood")

  const energyMulti = useMultiPick(
    value.energy,
    (next) => onChange({ energy: next as string | undefined }),
    1,
  )
  const emotionMulti = useMultiPick(
    value.emotion,
    (next) => onChange({ emotion: next }),
    3,
  )
  const vibeMulti = useMultiPick(
    value.vibe,
    (next) => onChange({ vibe: next }),
    3,
  )

  const filtered = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        entries: section.entries.filter((e) =>
          matches(e.id, e.label, e.description, query),
        ),
      })),
    [matches, query],
  )

  const anyVisible = filtered.some((s) => s.entries.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search mood"
          placeholder="Search energy, emotion, vibe"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No mood entry matches &quot;{query}&quot;
        </div>
      )}

      {filtered.map(({ key, label, entries, maxSelected }) => {
        if (query && entries.length === 0) return null
        const multi = key === "energy" ? energyMulti : key === "emotion" ? emotionMulti : vibeMulti
        const checked = multi.selectedIds.length > 0
        return (
          <SoundDimensionSection
            key={key}
            label={label}
            entries={entries}
            selectedIds={multi.selectedIds}
            maxSelected={maxSelected}
            isMultiData={multi.isMulti}
            checked={checked}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                const first = entries[0]?.id
                if (first) multi.handlePick(first)
              } else {
                onChange({ [key]: undefined } as Partial<MusicMoodValue>)
              }
            }}
            onPick={multi.handlePick}
            onActivateMulti={multi.activateMulti}
            onDemoteToSingle={multi.demoteToSingle}
          />
        )
      })}
    </div>
  )
})

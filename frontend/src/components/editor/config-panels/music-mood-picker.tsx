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

export interface MusicMoodValue {
  readonly energy?: string
  readonly emotion?: string
  readonly vibe?: string
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
}

const SECTIONS: ReadonlyArray<Section> = [
  { key: "energy",  label: "Energy",  entries: MUSIC_ENERGIES },
  { key: "emotion", label: "Emotion", entries: MUSIC_EMOTIONS },
  { key: "vibe",    label: "Vibe",    entries: MUSIC_VIBES    },
]

/**
 * Three single-select dimensions (energy / emotion / vibe). Each section
 * is independently toggleable via its checkbox; the search input filters
 * across all three at once.
 */
export const MusicMoodPicker = memo(function MusicMoodPicker({
  value,
  onChange,
  className,
}: MusicMoodPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("music-mood")

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

      {filtered.map(({ key, label, entries }) => {
        if (query && entries.length === 0) return null
        const current = value[key]
        const checked = current !== undefined && current !== ""
        const selectedIds = current ? [current] : []
        return (
          <SoundDimensionSection
            key={key}
            label={label}
            entries={entries}
            selectedIds={selectedIds}
            checked={checked}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                const first = entries[0]?.id
                if (first) onChange({ [key]: first } as Partial<MusicMoodValue>)
              } else {
                onChange({ [key]: undefined } as Partial<MusicMoodValue>)
              }
            }}
            onPick={(id) =>
              onChange({ [key]: current === id ? undefined : id } as Partial<MusicMoodValue>)
            }
          />
        )
      })}
    </div>
  )
})

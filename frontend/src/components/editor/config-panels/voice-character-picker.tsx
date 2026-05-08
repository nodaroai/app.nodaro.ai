"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  VOICE_AGES,
  VOICE_GENDERS,
  VOICE_ACCENTS,
  VOICE_TIMBRES,
  type VoiceCharacterEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"

export interface VoiceCharacterValue {
  readonly age?: string
  readonly gender?: string
  readonly accent?: string
  readonly timbre?: string
}

interface VoiceCharacterPickerProps {
  readonly value: VoiceCharacterValue
  readonly onChange: (patch: Partial<VoiceCharacterValue>) => void
  readonly className?: string
}

interface Section {
  readonly key: keyof VoiceCharacterValue
  readonly label: string
  readonly entries: ReadonlyArray<VoiceCharacterEntry>
}

const SECTIONS: ReadonlyArray<Section> = [
  { key: "age",     label: "Age",     entries: VOICE_AGES     },
  { key: "gender",  label: "Gender",  entries: VOICE_GENDERS  },
  { key: "accent",  label: "Accent",  entries: VOICE_ACCENTS  },
  { key: "timbre",  label: "Timbre",  entries: VOICE_TIMBRES  },
]

/**
 * Four single-select dimensions (age / gender / accent / timbre). Each
 * section is independently toggleable; the search input filters across
 * all four at once.
 */
export const VoiceCharacterPicker = memo(function VoiceCharacterPicker({
  value,
  onChange,
  className,
}: VoiceCharacterPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("voice-character")

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
          aria-label="Search voice character"
          placeholder="Search age, gender, accent, timbre"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No voice entry matches &quot;{query}&quot;
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
                if (first) onChange({ [key]: first } as Partial<VoiceCharacterValue>)
              } else {
                onChange({ [key]: undefined } as Partial<VoiceCharacterValue>)
              }
            }}
            onPick={(id) =>
              onChange({ [key]: current === id ? undefined : id } as Partial<VoiceCharacterValue>)
            }
          />
        )
      })}
    </div>
  )
})

"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  VOICE_PACES,
  VOICE_EMOTIONS,
  VOICE_ARCHETYPES,
  type VoiceDeliveryEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"

export interface VoiceDeliveryValue {
  readonly pace?: string
  readonly emotion?: string
  readonly archetype?: string
}

interface VoiceDeliveryPickerProps {
  readonly value: VoiceDeliveryValue
  readonly onChange: (patch: Partial<VoiceDeliveryValue>) => void
  readonly className?: string
}

interface Section {
  readonly key: keyof VoiceDeliveryValue
  readonly label: string
  readonly entries: ReadonlyArray<VoiceDeliveryEntry>
}

const SECTIONS: ReadonlyArray<Section> = [
  { key: "pace",       label: "Pace",       entries: VOICE_PACES       },
  { key: "emotion",    label: "Emotion",    entries: VOICE_EMOTIONS    },
  { key: "archetype",  label: "Archetype",  entries: VOICE_ARCHETYPES  },
]

/**
 * Three single-select dimensions (pace / emotion / archetype). Each
 * section is independently toggleable; the search input filters across
 * all three at once.
 */
export const VoiceDeliveryPicker = memo(function VoiceDeliveryPicker({
  value,
  onChange,
  className,
}: VoiceDeliveryPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("voice-delivery")

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
          aria-label="Search voice delivery"
          placeholder="Search pace, emotion, archetype"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No delivery entry matches &quot;{query}&quot;
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
                if (first) onChange({ [key]: first } as Partial<VoiceDeliveryValue>)
              } else {
                onChange({ [key]: undefined } as Partial<VoiceDeliveryValue>)
              }
            }}
            onPick={(id) =>
              onChange({ [key]: current === id ? undefined : id } as Partial<VoiceDeliveryValue>)
            }
          />
        )
      })}
    </div>
  )
})

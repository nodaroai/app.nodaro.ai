"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { VOICE_PACES as BASE_VOICE_PACES, VOICE_EMOTIONS as BASE_VOICE_EMOTIONS, VOICE_ARCHETYPES as BASE_VOICE_ARCHETYPES, type VoiceDeliveryEntry } from "@nodaro/prompts"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { SoundDimensionSection } from "./sound-dimension-section"
import { useCuratedEntries } from "../curated.js"

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

// Built per render from the CURATED lists, not at module scope from the
// bundled constants — a deployment's packs may remove or reword entries.
function buildSections(VOICE_ARCHETYPES: typeof BASE_VOICE_ARCHETYPES, VOICE_EMOTIONS: typeof BASE_VOICE_EMOTIONS, VOICE_PACES: typeof BASE_VOICE_PACES): ReadonlyArray<Section> {
  return [
    { key: "pace",       label: "Pace",       entries: VOICE_PACES       },
    { key: "emotion",    label: "Emotion",    entries: VOICE_EMOTIONS    },
    { key: "archetype",  label: "Archetype",  entries: VOICE_ARCHETYPES  },
  ]
}

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
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const VOICE_PACES = useCuratedEntries("voice-delivery", BASE_VOICE_PACES)
  const VOICE_EMOTIONS = useCuratedEntries("voice-delivery", BASE_VOICE_EMOTIONS)
  const VOICE_ARCHETYPES = useCuratedEntries("voice-delivery", BASE_VOICE_ARCHETYPES)
  const SECTIONS = useMemo(() => buildSections(VOICE_ARCHETYPES, VOICE_EMOTIONS, VOICE_PACES), [VOICE_ARCHETYPES, VOICE_EMOTIONS, VOICE_PACES])
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

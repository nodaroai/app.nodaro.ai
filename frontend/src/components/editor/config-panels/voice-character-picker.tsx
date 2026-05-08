"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  VOICE_AGES,
  VOICE_GENDERS,
  VOICE_LANGUAGES,
  VOICE_ACCENTS,
  VOICE_TIMBRES,
  pickIds,
  togglePick,
  type VoiceCharacterEntry,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"

/** Cap multi-language picks at 3 — codeswitching / multilingual voices. */
const MAX_LANGUAGES = 3

export interface VoiceCharacterValue {
  readonly age?: string
  readonly gender?: string
  readonly language?: string | ReadonlyArray<string>
  readonly accent?: string
  readonly timbre?: string
}

interface VoiceCharacterPickerProps {
  readonly value: VoiceCharacterValue
  readonly onChange: (patch: Partial<VoiceCharacterValue>) => void
  readonly className?: string
}

interface SingleSection {
  readonly key: "age" | "gender" | "accent" | "timbre"
  readonly label: string
  readonly entries: ReadonlyArray<VoiceCharacterEntry>
}

const SINGLE_SECTIONS: ReadonlyArray<SingleSection> = [
  { key: "age",     label: "Age",     entries: VOICE_AGES     },
  { key: "gender",  label: "Gender",  entries: VOICE_GENDERS  },
  { key: "accent",  label: "Accent",  entries: VOICE_ACCENTS  },
  { key: "timbre",  label: "Timbre",  entries: VOICE_TIMBRES  },
]

/**
 * Five dimensions: age (single), gender (single), language (multi up to 3),
 * accent (single), timbre (single). Language is multi-pick for
 * codeswitching / multilingual voice work — distinct from accent (which is
 * HOW it sounds vs language being WHAT'S being spoken).
 */
export const VoiceCharacterPicker = memo(function VoiceCharacterPicker({
  value,
  onChange,
  className,
}: VoiceCharacterPickerProps) {
  const [query, setQuery] = useState("")
  const [languageEnabled, setLanguageEnabled] = useState(false)
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("voice-character")

  const filteredSingle = useMemo(
    () =>
      SINGLE_SECTIONS.map((section) => ({
        ...section,
        entries: section.entries.filter((e) =>
          matches(e.id, e.label, e.description, query),
        ),
      })),
    [matches, query],
  )

  const filteredLanguages = useMemo(
    () => VOICE_LANGUAGES.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )

  const languageIds = pickIds(value.language)
  const isMultiLanguage = Array.isArray(value.language)
  const languageChecked = languageEnabled || languageIds.length > 0

  const anyVisible =
    filteredSingle.some((s) => s.entries.length > 0) ||
    filteredLanguages.length > 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search voice character"
          placeholder="Search age, gender, language, accent, timbre"
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

      {/* Age + Gender first */}
      {filteredSingle.slice(0, 2).map(({ key, label, entries }) => {
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

      {/* Language (multi up to 3) */}
      {(!query || filteredLanguages.length > 0) && (
        <SoundDimensionSection
          label="Language"
          entries={filteredLanguages}
          selectedIds={languageIds}
          maxSelected={MAX_LANGUAGES}
          isMultiData={isMultiLanguage}
          checked={languageChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              setLanguageEnabled(true)
            } else {
              setLanguageEnabled(false)
              onChange({ language: undefined })
            }
          }}
          onPick={(id) => {
            if (!isMultiLanguage) {
              if (languageIds[0] === id) {
                onChange({ language: undefined })
              } else {
                onChange({ language: id })
              }
              return
            }
            const next = togglePick(languageIds, id, MAX_LANGUAGES)
            onChange({ language: next.length === 0 ? undefined : next })
          }}
          onActivateMulti={(id) => onChange({ language: [id] })}
          onDemoteToSingle={(id) => onChange({ language: id })}
        />
      )}

      {/* Accent + Timbre last */}
      {filteredSingle.slice(2).map(({ key, label, entries }) => {
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

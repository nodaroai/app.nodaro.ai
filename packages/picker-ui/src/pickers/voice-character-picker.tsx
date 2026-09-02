"use client"

import { Fragment, memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { VOICE_AGES as BASE_VOICE_AGES, VOICE_GENDERS as BASE_VOICE_GENDERS, VOICE_LANGUAGES as BASE_VOICE_LANGUAGES, VOICE_ACCENTS as BASE_VOICE_ACCENTS, VOICE_TIMBRES as BASE_VOICE_TIMBRES, type VoiceCharacterEntry } from "@nodaro/prompts"
import { pickIds, togglePick } from "@nodaro/shared"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { SoundDimensionSection } from "./sound-dimension-section"
import { useCuratedEntries } from "../curated.js"

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

type SingleKey = "age" | "gender" | "accent" | "timbre"
interface SingleSection {
  readonly key: SingleKey
  readonly label: string
  readonly entries: ReadonlyArray<VoiceCharacterEntry>
}

// Built per render from the CURATED lists, not at module scope from the
// bundled constants — a deployment's packs may remove or reword entries.
function buildSingleSections(VOICE_ACCENTS: typeof BASE_VOICE_ACCENTS, VOICE_AGES: typeof BASE_VOICE_AGES, VOICE_GENDERS: typeof BASE_VOICE_GENDERS, VOICE_TIMBRES: typeof BASE_VOICE_TIMBRES): ReadonlyArray<SingleSection> {
  return [
    { key: "age",     label: "Age",     entries: VOICE_AGES     },
    { key: "gender",  label: "Gender",  entries: VOICE_GENDERS  },
    { key: "accent",  label: "Accent",  entries: VOICE_ACCENTS  },
    { key: "timbre",  label: "Timbre",  entries: VOICE_TIMBRES  },
  ]
}

/** Index where Language is interleaved (between Gender and Accent). */
const LANGUAGE_INSERT_AT = 2

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
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const VOICE_AGES = useCuratedEntries("voice-character", BASE_VOICE_AGES)
  const VOICE_GENDERS = useCuratedEntries("voice-character", BASE_VOICE_GENDERS)
  const VOICE_LANGUAGES = useCuratedEntries("voice-character", BASE_VOICE_LANGUAGES)
  const VOICE_ACCENTS = useCuratedEntries("voice-character", BASE_VOICE_ACCENTS)
  const VOICE_TIMBRES = useCuratedEntries("voice-character", BASE_VOICE_TIMBRES)
  const SINGLE_SECTIONS = useMemo(() => buildSingleSections(VOICE_ACCENTS, VOICE_AGES, VOICE_GENDERS, VOICE_TIMBRES), [VOICE_ACCENTS, VOICE_AGES, VOICE_GENDERS, VOICE_TIMBRES])
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
  const languageVisible = !query || filteredLanguages.length > 0

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

      {filteredSingle.map((section, idx) => (
        <Fragment key={section.key}>
          {idx === LANGUAGE_INSERT_AT && languageVisible && (
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
                setLanguageEnabled(next)
                if (!next) onChange({ language: undefined })
              }}
              onPick={(id) => {
                if (!isMultiLanguage) {
                  onChange({ language: languageIds[0] === id ? undefined : id })
                  return
                }
                const next = togglePick(languageIds, id, MAX_LANGUAGES)
                onChange({ language: next.length === 0 ? undefined : next })
              }}
              onActivateMulti={(id) => onChange({ language: [id] })}
              onDemoteToSingle={(id) => onChange({ language: id })}
            />
          )}
          {(!query || section.entries.length > 0) && (
            <SoundDimensionSection
              label={section.label}
              entries={section.entries}
              selectedIds={value[section.key] ? [value[section.key]!] : []}
              checked={!!value[section.key]}
              resolveLabel={resolveLabel}
              resolveDescription={resolveDescription}
              onToggle={(next) => {
                if (next) {
                  const first = section.entries[0]?.id
                  if (first) onChange({ [section.key]: first } as Partial<VoiceCharacterValue>)
                } else {
                  onChange({ [section.key]: undefined } as Partial<VoiceCharacterValue>)
                }
              }}
              onPick={(id) =>
                onChange({
                  [section.key]: value[section.key] === id ? undefined : id,
                } as Partial<VoiceCharacterValue>)
              }
            />
          )}
        </Fragment>
      ))}
    </div>
  )
})

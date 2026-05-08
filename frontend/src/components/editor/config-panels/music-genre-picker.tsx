"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  MUSIC_GENRES,
  MUSIC_ERAS,
  MUSIC_GENRE_CATEGORY_ORDER,
  MUSIC_GENRE_CATEGORY_LABELS,
  getMusicGenre,
  pickIds,
  togglePick,
  type MusicGenre,
  type MusicSubgenre,
  type MusicEra,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"
import { SoundTabbedSection, type TabbedEntry } from "./sound-tabbed-section"

/** Cap multi-genre picks at 3 to keep prompt-hint composability sane. */
const MAX_GENRES = 3

export interface MusicGenreValue {
  readonly genre?: string | ReadonlyArray<string>
  readonly subgenre?: string
  readonly era?: string
}

interface MusicGenrePickerProps {
  readonly value: MusicGenreValue
  readonly onChange: (patch: Partial<MusicGenreValue>) => void
  readonly className?: string
}

/** Subgenres lack a `description` in the catalog — fall back to the label so
 *  the SoundDimensionSection's tooltip + a11y description stay populated. */
function subgenreEntries(genre: MusicGenre | undefined): ReadonlyArray<{
  id: string
  label: string
  description: string
}> {
  if (!genre) return []
  return genre.subgenres.map((sub: MusicSubgenre) => ({
    id: sub.id,
    label: sub.label,
    description: sub.label,
  }))
}

/**
 * Hierarchical music picker:
 *  - Genre (multi-pick up to 3, tabbed by category — tabs match Splice's
 *    genre taxonomy: Hip Hop / R&B, Electronic, Pop, Rock / Metal,
 *    Acoustic, Global, Cinematic / Score)
 *  - Subgenre (only meaningful for a single chosen genre — section hides
 *    in multi-genre mode)
 *  - Era (flat tile grid)
 */
export const MusicGenrePicker = memo(function MusicGenrePicker({
  value,
  onChange,
  className,
}: MusicGenrePickerProps) {
  const [query, setQuery] = useState("")
  /** Explicit-enable for the genre section (mirrors StylingPicker pattern). */
  const [genreEnabled, setGenreEnabled] = useState(false)
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("music-genre")

  const genreIds = pickIds(value.genre)
  const isMultiGenre = Array.isArray(value.genre)
  const genreChecked = genreEnabled || genreIds.length > 0

  const filteredGenreEntries = useMemo<ReadonlyArray<TabbedEntry>>(() => {
    return MUSIC_GENRES
      .filter((g) => matches(g.id, g.label, g.description, query))
      .map((g) => ({
        id: g.id,
        label: g.label,
        description: g.description,
        group: g.category,
      }))
  }, [matches, query])

  const filteredEras = useMemo<ReadonlyArray<MusicEra>>(
    () => MUSIC_ERAS.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )

  const singleGenreId = genreIds.length === 1 ? genreIds[0] : undefined
  const currentGenre = getMusicGenre(singleGenreId)
  const allSubgenres = subgenreEntries(currentGenre)
  const filteredSubgenres = useMemo(
    () =>
      allSubgenres.filter((s) =>
        matches(s.id, s.label, s.description, query),
      ),
    [allSubgenres, matches, query],
  )

  const subgenreChecked = value.subgenre !== undefined && value.subgenre !== ""
  const eraChecked = value.era !== undefined && value.era !== ""

  const anyVisible =
    filteredGenreEntries.length > 0 ||
    filteredSubgenres.length > 0 ||
    filteredEras.length > 0

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search music genre"
          placeholder="Search genre, subgenre, era"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No music entry matches &quot;{query}&quot;
        </div>
      )}

      {(!query || filteredGenreEntries.length > 0) && (
        <SoundTabbedSection
          label="Genre"
          entries={filteredGenreEntries}
          groupOrder={MUSIC_GENRE_CATEGORY_ORDER as ReadonlyArray<string>}
          groupLabels={MUSIC_GENRE_CATEGORY_LABELS as Readonly<Record<string, string>>}
          selectedIds={genreIds}
          maxSelected={MAX_GENRES}
          isMultiData={isMultiGenre}
          checked={genreChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              setGenreEnabled(true)
            } else {
              setGenreEnabled(false)
              onChange({ genre: undefined, subgenre: undefined })
            }
          }}
          onPick={(id) => {
            if (!isMultiGenre) {
              // Single mode: replace, clear, or pick. Picking a different
              // genre clears the subgenre (subgenre is genre-specific).
              if (genreIds[0] === id) {
                onChange({ genre: undefined, subgenre: undefined })
              } else {
                onChange({ genre: id, subgenre: undefined })
              }
              return
            }
            // Multi mode: toggle id in the array. Adding a 4th id FIFO-replaces
            // the oldest. Subgenre is meaningless when multi — clear it.
            const next = togglePick(genreIds, id, MAX_GENRES)
            onChange({
              genre: next.length === 0 ? undefined : next,
              subgenre: undefined,
            })
          }}
          onActivateMulti={(id) => onChange({ genre: [id], subgenre: undefined })}
          onDemoteToSingle={(id) => onChange({ genre: id })}
        />
      )}

      {/* Subgenre only meaningful when exactly one genre is picked. */}
      {currentGenre && allSubgenres.length > 0 && (!query || filteredSubgenres.length > 0) && (
        <SoundDimensionSection
          label="Subgenre"
          entries={filteredSubgenres}
          selectedIds={value.subgenre ? [value.subgenre] : []}
          checked={subgenreChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              const first = filteredSubgenres[0]?.id ?? allSubgenres[0]?.id
              if (first) onChange({ subgenre: first })
            } else {
              onChange({ subgenre: undefined })
            }
          }}
          onPick={(id) =>
            onChange({ subgenre: value.subgenre === id ? undefined : id })
          }
        />
      )}

      {(!query || filteredEras.length > 0) && (
        <SoundDimensionSection
          label="Era"
          entries={filteredEras}
          selectedIds={value.era ? [value.era] : []}
          checked={eraChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              const first = filteredEras[0]?.id ?? MUSIC_ERAS[0]?.id
              if (first) onChange({ era: first })
            } else {
              onChange({ era: undefined })
            }
          }}
          onPick={(id) =>
            onChange({ era: value.era === id ? undefined : id })
          }
        />
      )}
    </div>
  )
})

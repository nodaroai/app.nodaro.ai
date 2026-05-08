"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  MUSIC_GENRES,
  MUSIC_ERAS,
  getMusicGenre,
  type MusicGenre,
  type MusicSubgenre,
  type MusicEra,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { SoundDimensionSection } from "./sound-dimension-section"

export interface MusicGenreValue {
  readonly genre?: string
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
 * Hierarchical music picker: Genre → (dependent) Subgenre + Era. Picking a
 * new genre auto-clears the subgenre if it doesn't belong to the new genre.
 * Genres with no subgenres (Blues, Reggae, World) hide the Subgenre section.
 */
export const MusicGenrePicker = memo(function MusicGenrePicker({
  value,
  onChange,
  className,
}: MusicGenrePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("music-genre")

  const filteredGenres = useMemo<ReadonlyArray<MusicGenre>>(
    () => MUSIC_GENRES.filter((g) => matches(g.id, g.label, g.description, query)),
    [matches, query],
  )
  const filteredEras = useMemo<ReadonlyArray<MusicEra>>(
    () => MUSIC_ERAS.filter((e) => matches(e.id, e.label, e.description, query)),
    [matches, query],
  )

  const currentGenre = getMusicGenre(value.genre)
  const allSubgenres = subgenreEntries(currentGenre)
  const filteredSubgenres = useMemo(
    () =>
      allSubgenres.filter((s) =>
        matches(s.id, s.label, s.description, query),
      ),
    [allSubgenres, matches, query],
  )

  const genreChecked = value.genre !== undefined && value.genre !== ""
  const subgenreChecked = value.subgenre !== undefined && value.subgenre !== ""
  const eraChecked = value.era !== undefined && value.era !== ""

  const anyVisible =
    filteredGenres.length > 0 ||
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

      {(!query || filteredGenres.length > 0) && (
        <SoundDimensionSection
          label="Genre"
          entries={filteredGenres}
          selectedIds={value.genre ? [value.genre] : []}
          checked={genreChecked}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onToggle={(next) => {
            if (next) {
              const first = filteredGenres[0]?.id ?? MUSIC_GENRES[0]?.id
              if (first) onChange({ genre: first })
            } else {
              onChange({ genre: undefined, subgenre: undefined })
            }
          }}
          onPick={(id) => {
            if (value.genre === id) {
              onChange({ genre: undefined, subgenre: undefined })
            } else {
              // Different genre → drop any stale subgenre.
              onChange({ genre: id, subgenre: undefined })
            }
          }}
        />
      )}

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

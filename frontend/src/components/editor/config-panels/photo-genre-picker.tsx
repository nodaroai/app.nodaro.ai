"use client"

import { memo, useMemo, useState } from "react"
import { Search, Camera } from "lucide-react"
import {
  PHOTO_GENRES,
  PHOTO_GENRE_CATEGORY_LABELS,
  PHOTO_GENRE_CATEGORY_ORDER,
  type PhotoGenre,
  type PhotoGenreCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface PhotoGenrePickerProps {
  readonly value: string
  readonly onValueChange: (genreId: string) => void
  readonly className?: string
}

/**
 * Single-select Photo Genre picker. Genres are grouped by category
 * (Editorial / Fashion, Documentary / Candid, Studio / Formal, Selfie,
 * Print / Context). Search filters across label + description.
 */
export const PhotoGenrePicker = memo(function PhotoGenrePicker({
  value,
  onValueChange,
  className,
}: PhotoGenrePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("photo-genre")

  const grouped = useMemo(() => {
    const byCategory = new Map<PhotoGenreCategory, PhotoGenre[]>()
    for (const genre of PHOTO_GENRES) {
      if (!matches(genre.id, genre.label, genre.description, query)) {
        continue
      }
      const list = byCategory.get(genre.category) ?? []
      list.push(genre)
      byCategory.set(genre.category, list)
    }
    return PHOTO_GENRE_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      genres: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.genres.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search photo genre"
          placeholder="Search photo genre"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No photo genre matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, genres }) => {
        if (genres.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {PHOTO_GENRE_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={PHOTO_GENRE_CATEGORY_LABELS[category]} className="grid grid-cols-2 gap-1.5">
              {genres.map((genre) => {
                const selected = genre.id === value
                const label = resolveLabel(genre.id, genre.label)
                const description = resolveDescription(genre.id, genre.description)
                return (
                  <button
                    key={genre.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(genre.id)}
                    className={cn(
                      "group flex flex-col gap-1 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Camera className={cn("size-3 shrink-0", selected ? "text-[#ff0073]" : "text-muted-foreground")} aria-hidden="true" />
                      <FitText
                        text={label}
                        className={cn(
                          "text-[11px] font-medium leading-tight",
                          selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                        )}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                      {description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})

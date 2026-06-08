"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  pickIds,
  type Person,
  type PersonDimension,
  type PersonValue,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import {
  PersonDimensionGrid,
  MAX_SELECTED_BY_DIMENSION,
} from "./person-dimension-grid"

interface PersonPickerDetailedProps {
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly className?: string
}

/**
 * Multi-dimension person picker (DETAILED view): each of the 9 person dimensions
 * (type, age, ethnicity, build, hair-color, hair-style, skin-tone, eye-color,
 * facial-hair) is an independent checkbox section. User can enable any
 * combination of dimensions and pick one entry per enabled dimension.
 * A real person combines entries from multiple dimensions (e.g.
 * "Beautiful Woman + 30s + East Asian + Slim + Long Wavy + Brown +
 * Fair + Green").
 *
 * This is the verbatim body of the original `PersonPicker`; the public
 * `PersonPicker` is now a thin wrapper that toggles Compact vs Detailed and
 * renders this for the Detailed branch.
 */
export const PersonPickerDetailed = memo(function PersonPickerDetailed({
  value,
  onChange,
  className,
}: PersonPickerDetailedProps) {
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  user picks what they want. We track explicit enable here so the section
   *  stays "checked" without forcing a default selection. */
  const [enabledMulti, setEnabledMulti] = useState<Set<PersonDimension>>(new Set())
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("person")

  const grouped = useMemo(() => {
    const byDimension = new Map<PersonDimension, Person[]>()
    for (const person of PEOPLE) {
      if (!matches(person.id, person.label, person.description, query)) {
        continue
      }
      const list = byDimension.get(person.dimension) ?? []
      list.push(person)
      byDimension.set(person.dimension, list)
    }
    return PERSON_DIMENSION_ORDER.map((dim) => ({
      dimension: dim,
      entries: byDimension.get(dim) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.entries.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search person"
          placeholder="Search person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No person attributes match &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ dimension, entries }) => {
        const field = PERSON_FIELD_BY_DIMENSION[dimension]
        const selectedIds = pickIds(value[field])
        const maxSelected = MAX_SELECTED_BY_DIMENSION[dimension] ?? 1
        const isMultiCapable = maxSelected > 1
        const checked = isMultiCapable
          ? enabledMulti.has(dimension) || selectedIds.length > 0
          : selectedIds.length > 0
        // While searching, drop dimensions with no matching entries so the
        // result list reads cleanly (the grid itself would render an empty grid).
        if (query && entries.length === 0) return null
        return (
          <PersonDimensionGrid
            key={dimension}
            dimension={dimension}
            value={value}
            onChange={onChange}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            matches={matches}
            search={query}
            enabled={checked}
            onToggleEnabled={(next) => {
              if (next) {
                if (isMultiCapable) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.add(dimension)
                    return n
                  })
                }
                // Single-pick toggle-on side-effect (selecting the first id) is
                // handled inside PersonDimensionGrid's Switch via enableSingle().
              } else {
                if (isMultiCapable) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.delete(dimension)
                    return n
                  })
                }
                // The value clear (age-aware) is handled inside the grid's
                // Switch via toggleOff().
              }
            }}
          />
        )
      })}
    </div>
  )
})

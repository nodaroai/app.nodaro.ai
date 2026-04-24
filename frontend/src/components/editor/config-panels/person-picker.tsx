"use client"

import { memo, useId, useMemo, useState, type JSX } from "react"
import { Search } from "lucide-react"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  type Person,
  type PersonDimension,
  type PersonValue,
} from "@nodaro-shared/person"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { ColorSwatch } from "./color-swatch"
import { getPersonSwatch } from "./color-swatches"
import {
  BuildIcon,
  FacialHairIcon,
  FaceShapeIcon,
  JawlineIcon,
  EyeShapeIcon,
  NoseIcon,
  LipsIcon,
  BodyProportionsIcon,
} from "./small-silhouette-icons"

interface PersonPickerProps {
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly className?: string
}

/**
 * Multi-dimension person picker: each of the 9 person dimensions (type,
 * age, ethnicity, build, hair-color, hair-style, skin-tone, eye-color,
 * facial-hair) is an independent checkbox section. User can enable any
 * combination of dimensions and pick one entry per enabled dimension.
 * A real person combines entries from multiple dimensions (e.g.
 * "Beautiful Woman + 30s + East Asian + Slim + Long Wavy + Brown +
 * Fair + Green").
 */
export const PersonPicker = memo(function PersonPicker({
  value,
  onChange,
  className,
}: PersonPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byDimension = new Map<PersonDimension, Person[]>()
    for (const person of PEOPLE) {
      if (q && !person.label.toLowerCase().includes(q) && !person.description.toLowerCase().includes(q)) {
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
  }, [query])

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
        const current = value[field]
        const checked = current !== undefined && current !== ""
        if (query && entries.length === 0) return null
        return (
          <DimensionSection
            key={dimension}
            dimension={dimension}
            entries={entries}
            field={field}
            checked={checked}
            current={current}
            onToggle={(next) => {
              if (next) {
                const first = PEOPLE.find((p) => p.dimension === dimension)?.id
                if (first) onChange({ [field]: first } as Partial<PersonValue>)
              } else {
                onChange({ [field]: undefined } as Partial<PersonValue>)
              }
            }}
            onPick={(id) => onChange({ [field]: id } as Partial<PersonValue>)}
          />
        )
      })}
    </div>
  )
})

interface DimensionSectionProps {
  readonly dimension: PersonDimension
  readonly entries: ReadonlyArray<Person>
  readonly field: keyof PersonValue
  readonly checked: boolean
  readonly current: string | undefined
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function DimensionSection({
  dimension,
  entries,
  field,
  checked,
  current,
  onToggle,
  onPick,
}: DimensionSectionProps) {
  const id = useId()
  const label = PERSON_DIMENSION_LABELS[dimension]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <input
          type="checkbox"
          id={`${id}-${field}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-muted-foreground/40"
        />
        <label
          htmlFor={`${id}-${field}`}
          className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground select-none cursor-pointer"
        >
          {label}
        </label>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}
      >
        {entries.map((entry) => {
          const selected = checked && entry.id === current
          const swatch = getPersonSwatch(entry.id)
          let icon: JSX.Element | null = null
          if (dimension === "build") icon = <BuildIcon buildId={entry.id} className="size-6" />
          else if (dimension === "facial-hair") icon = <FacialHairIcon facialHairId={entry.id} className="size-6" />
          else if (dimension === "face-shape") icon = <FaceShapeIcon id={entry.id} className="size-6" />
          else if (dimension === "jawline") icon = <JawlineIcon id={entry.id} className="size-6" />
          else if (dimension === "eye-shape") icon = <EyeShapeIcon id={entry.id} className="size-6" />
          else if (dimension === "nose") icon = <NoseIcon id={entry.id} className="size-6" />
          else if (dimension === "lips") icon = <LipsIcon id={entry.id} className="size-6" />
          else if (dimension === "body-proportions") icon = <BodyProportionsIcon id={entry.id} className="size-6" />
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={checked ? entry.description : `${entry.description} (click to enable ${label})`}
              onClick={() => onPick(entry.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              {swatch && <ColorSwatch value={swatch} className="size-5" />}
              {icon}
              <span
                className={cn(
                  "text-[11px] font-medium leading-tight truncate max-w-full",
                  selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              >
                {entry.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

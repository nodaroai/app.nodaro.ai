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

function renderEntryIcon(dimension: PersonDimension, entry: Person): JSX.Element | null {
  if (dimension === "build") return <BuildIcon buildId={entry.id} className="size-6" />
  if (dimension === "facial-hair") return <FacialHairIcon facialHairId={entry.id} className="size-6" />
  if (dimension === "face-shape") return <FaceShapeIcon id={entry.id} className="size-6" />
  if (dimension === "jawline") return <JawlineIcon id={entry.id} className="size-6" />
  if (dimension === "eye-shape") return <EyeShapeIcon id={entry.id} className="size-6" />
  if (dimension === "nose") return <NoseIcon id={entry.id} className="size-6" />
  if (dimension === "lips") return <LipsIcon id={entry.id} className="size-6" />
  if (dimension === "body-proportions") return <BodyProportionsIcon id={entry.id} className="size-6" />
  return null
}

function EntryChip({
  dimension,
  entry,
  selected,
  enabled,
  label,
  onPick,
}: {
  readonly dimension: PersonDimension
  readonly entry: Person
  readonly selected: boolean
  readonly enabled: boolean
  readonly label: string
  readonly onPick: (id: string) => void
}) {
  const swatch = getPersonSwatch(entry.id)
  const icon = renderEntryIcon(dimension, entry)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={enabled ? entry.description : `${entry.description} (click to enable ${label})`}
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
        {entry.shortLabel ?? entry.label}
      </span>
    </button>
  )
}

function GroupedEntryGrid({
  dimension,
  entries,
  checked,
  current,
  label,
  onPick,
}: {
  readonly dimension: PersonDimension
  readonly entries: ReadonlyArray<Person>
  readonly checked: boolean
  readonly current: string | undefined
  readonly label: string
  readonly onPick: (id: string) => void
}) {
  // Build ordered group list preserving catalog order.
  const groupOrder: string[] = []
  const byGroup = new Map<string, Person[]>()
  for (const e of entries) {
    const g = e.group ?? "Other"
    if (!byGroup.has(g)) {
      groupOrder.push(g)
      byGroup.set(g, [])
    }
    byGroup.get(g)!.push(e)
  }

  // The group containing the current pick starts open; other groups closed.
  const activeGroup = current ? entries.find((e) => e.id === current)?.group ?? undefined : undefined
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []))
  const toggleGroup = (g: string) => setOpenGroups((prev) => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    return next
  })

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-col gap-1 transition-opacity", !checked && "opacity-40")}>
      {groupOrder.map((group) => {
        const list = byGroup.get(group)!
        const isOpen = openGroups.has(group)
        const hasCurrent = list.some((e) => e.id === current)
        return (
          <div key={group} className="rounded-md border border-gray-200 dark:border-[#2D2D2D] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium transition-colors",
                hasCurrent
                  ? "bg-[#ff0073]/8 text-[#ff0073]"
                  : "bg-gray-50 dark:bg-[#161616] text-gray-700 dark:text-[#E2E8F0] hover:bg-gray-100 dark:hover:bg-[#1a1a1a]",
              )}
              aria-expanded={isOpen}
            >
              <span className="truncate text-left flex-1">{group}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {list.length}{hasCurrent ? " · selected" : ""}
              </span>
              <span className="text-muted-foreground shrink-0">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-white dark:bg-[#0f0f0f]">
                {list.map((entry) => (
                  <EntryChip
                    key={entry.id}
                    dimension={dimension}
                    entry={entry}
                    selected={checked && entry.id === current}
                    enabled={checked}
                    label={label}
                    onPick={onPick}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
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
  // Ethnicity has 39 entries across 6 groups — render as collapsible two-level
  // picker (region header → specific entries inside). Other dims stay as flat
  // chip grids since their entry counts are small enough.
  const useGrouped = dimension === "ethnicity"
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
      {useGrouped ? (
        <GroupedEntryGrid
          dimension={dimension}
          entries={entries}
          checked={checked}
          current={current}
          label={label}
          onPick={onPick}
        />
      ) : (
        <div
          role="radiogroup"
          aria-label={label}
          className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}
        >
          {entries.map((entry) => (
            <EntryChip
              key={entry.id}
              dimension={dimension}
              entry={entry}
              selected={checked && entry.id === current}
              enabled={checked}
              label={label}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

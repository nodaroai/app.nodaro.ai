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
import { pickIds, togglePick } from "@nodaro-shared/multi-pick"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { ColorSwatch } from "./color-swatch"
import { getPersonSwatch } from "./color-swatches"

/** Per-dimension multi-select cap.
 *  - ethnicity: 2 (mixed heritage)
 *  - hair-color: 2 (two-tone, ombre, highlights, balayage)
 *  - eye-color: 2 (heterochromia)
 *  - distinctive-features: 3 (combined features — freckles + glasses + tattoo)
 *  - lip-state: 2 (glossy + parted, bitten + bold-red, …)
 *  - eye-state: 2 (half-lidded + glassy, gazing-away + glassy, …)
 *  - skin-texture: 2 (porcelain + freckled, sun-kissed + dewy, …)
 *  All other dims are single-select. */
const MAX_SELECTED_BY_DIMENSION: Partial<Record<PersonDimension, number>> = {
  ethnicity: 2,
  "hair-color": 2,
  "eye-color": 2,
  "distinctive-features": 3,
  "lip-state": 2,
  "eye-state": 2,
  "skin-texture": 2,
}
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
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

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
        const raw = value[field]
        const selectedIds = pickIds(raw)
        const maxSelected = MAX_SELECTED_BY_DIMENSION[dimension] ?? 1
        const isMulti = maxSelected > 1
        const checked = isMulti
          ? enabledMulti.has(dimension) || selectedIds.length > 0
          : selectedIds.length > 0
        if (query && entries.length === 0) return null
        return (
          <DimensionSection
            key={dimension}
            dimension={dimension}
            entries={entries}
            field={field}
            checked={checked}
            selectedIds={selectedIds}
            maxSelected={maxSelected}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                if (isMulti) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.add(dimension)
                    return n
                  })
                } else {
                  const first = PEOPLE.find((p) => p.dimension === dimension)?.id
                  if (first) onChange({ [field]: first } as Partial<PersonValue>)
                }
              } else {
                if (isMulti) {
                  setEnabledMulti((s) => {
                    const n = new Set(s)
                    n.delete(dimension)
                    return n
                  })
                }
                onChange({ [field]: undefined } as Partial<PersonValue>)
              }
            }}
            onPick={(id) => {
              if (maxSelected <= 1) {
                onChange({ [field]: id } as Partial<PersonValue>)
                return
              }
              const next = togglePick(selectedIds, id, maxSelected)
              if (next.length === 0) onChange({ [field]: undefined } as Partial<PersonValue>)
              else if (next.length === 1) onChange({ [field]: next[0] } as Partial<PersonValue>)
              else onChange({ [field]: next } as Partial<PersonValue>)
            }}
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
  readonly selectedIds: ReadonlyArray<string>
  readonly maxSelected: number
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
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
  selectedIndex,
  multi,
  enabled,
  label,
  resolveLabel,
  resolveDescription,
  onPick,
}: {
  readonly dimension: PersonDimension
  readonly entry: Person
  readonly selected: boolean
  /** Position in the multi-pick array (0-based). -1 if not selected. */
  readonly selectedIndex: number
  /** True when this dimension allows multi-pick (>1 max). */
  readonly multi: boolean
  readonly enabled: boolean
  readonly label: string
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onPick: (id: string) => void
}) {
  const swatch = getPersonSwatch(entry.id)
  const icon = renderEntryIcon(dimension, entry)
  // Resolved label uses shortLabel as English fallback (compact display); when
  // a localized translation exists, it takes precedence.
  const resolvedLabel = resolveLabel(entry.id, entry.shortLabel ?? entry.label)
  const resolvedDescription = resolveDescription(entry.id, entry.description)
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      title={enabled ? resolvedDescription : `${resolvedDescription} (click to enable ${label})`}
      onClick={() => onPick(entry.id)}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
        selected
          ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
          : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
      )}
    >
      {multi && selected && (
        <span
          className="absolute top-1 right-1 size-4 rounded-full bg-[#ff0073] text-white text-[9px] font-semibold flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          {selectedIndex + 1}
        </span>
      )}
      {swatch && <ColorSwatch value={swatch} className="size-5" />}
      {icon}
      <FitText
        text={resolvedLabel}
        className={cn(
          "text-[11px] font-medium leading-tight max-w-full",
          selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
        )}
      />
    </button>
  )
}

function GroupedEntryGrid({
  dimension,
  entries,
  checked,
  selectedIds,
  multi,
  label,
  resolveLabel,
  resolveDescription,
  onPick,
}: {
  readonly dimension: PersonDimension
  readonly entries: ReadonlyArray<Person>
  readonly checked: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly multi: boolean
  readonly label: string
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
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

  // Groups containing any selected pick start open; other groups closed. With
  // multi-select, both picks' groups open so users can see what they've chosen.
  const activeGroups = useMemo(() => {
    const set = new Set<string>()
    for (const id of selectedIds) {
      const g = entries.find((e) => e.id === id)?.group
      if (g) set.add(g)
    }
    return set
  }, [selectedIds, entries])
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroups))
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
        const groupSelectedCount = list.reduce(
          (n, e) => (selectedIds.includes(e.id) ? n + 1 : n),
          0,
        )
        const hasCurrent = groupSelectedCount > 0
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
                {list.length}
                {hasCurrent ? ` · ${groupSelectedCount} selected` : ""}
              </span>
              <span className="text-muted-foreground shrink-0">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-white dark:bg-[#0f0f0f]">
                {list.map((entry) => {
                  const idx = selectedIds.indexOf(entry.id)
                  return (
                    <EntryChip
                      key={entry.id}
                      dimension={dimension}
                      entry={entry}
                      selected={checked && idx >= 0}
                      selectedIndex={idx}
                      multi={multi}
                      enabled={checked}
                      label={label}
                      resolveLabel={resolveLabel}
                      resolveDescription={resolveDescription}
                      onPick={onPick}
                    />
                  )
                })}
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
  selectedIds,
  maxSelected,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
}: DimensionSectionProps) {
  const id = useId()
  const baseLabel = PERSON_DIMENSION_LABELS[dimension]
  const multi = maxSelected > 1
  const label = multi ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
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
          selectedIds={selectedIds}
          multi={multi}
          label={label}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onPick={onPick}
        />
      ) : (
        <div
          role={multi ? "group" : "radiogroup"}
          aria-label={label}
          className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}
        >
          {entries.map((entry) => {
            const idx = selectedIds.indexOf(entry.id)
            return (
              <EntryChip
                key={entry.id}
                dimension={dimension}
                entry={entry}
                selected={checked && idx >= 0}
                selectedIndex={idx}
                multi={multi}
                enabled={checked}
                label={label}
                resolveLabel={resolveLabel}
                resolveDescription={resolveDescription}
                onPick={onPick}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

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
} from "@nodaro/shared"
import { pickIds, togglePick } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { ColorSwatch } from "./color-swatch"
import { getPersonSwatch } from "./color-swatches"
import { MultiPickBadge } from "./multi-pick-ui"

/** Compact group labels for the tab row. The catalog uses descriptive names
 *  ("Realistic — Style", "Iconic / Public Domain") that don't fit a chip. */
const COMPACT_GROUP_LABELS: Record<string, string> = {
  "Realistic — Style": "Style",
  "Iconic / Public Domain": "Iconic",
  "Primitive / Wild": "Primitive",
  "Mythic / Divine": "Mythic",
  "Heroes & Villains": "Heroes",
  "Hybrid / Anthro": "Anthro",
  "Warriors / Martial": "Warriors",
  "Professions / Roles": "Professions",
}
const compactGroupLabel = (g: string): string => COMPACT_GROUP_LABELS[g] ?? g

/** Per-dimension multi-select cap.
 *  - ethnicity: 2 (mixed heritage)
 *  - regional-aesthetic: 2 (hybrid look — e.g. nyc-fashion + parisienne)
 *  - hair-color: 2 (two-tone, ombre, highlights, balayage)
 *  - eye-color: 2 (heterochromia)
 *  - distinctive-features: 3 (combined features — freckles + glasses + tattoo)
 *  - lip-state: 2 (glossy + parted, bitten + bold-red, …)
 *  - eye-state: 2 (half-lidded + glassy, gazing-away + glassy, …)
 *  - skin-texture: 2 (porcelain + freckled, sun-kissed + dewy, …)
 *  All other dims are single-select. */
const MAX_SELECTED_BY_DIMENSION: Partial<Record<PersonDimension, number>> = {
  ethnicity: 2,
  "regional-aesthetic": 2,
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
        const isMultiCapable = maxSelected > 1
        const isMultiData = Array.isArray(raw)
        const checked = isMultiCapable
          ? enabledMulti.has(dimension) || selectedIds.length > 0
          : selectedIds.length > 0
        if (query && entries.length === 0) return null
        const isAge = dimension === "age"
        const isAgeCustom = isAge && value.age === "age-custom"
        return (
          <div key={dimension} className="flex flex-col gap-1.5">
            <DimensionSection
              dimension={dimension}
              entries={entries}
              field={field}
              checked={checked}
              selectedIds={selectedIds}
              maxSelected={maxSelected}
              isMultiData={isMultiData}
              isSearching={Boolean(query)}
              resolveLabel={resolveLabel}
              resolveDescription={resolveDescription}
              onToggle={(next) => {
                if (next) {
                  if (isMultiCapable) {
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
                  if (isMultiCapable) {
                    setEnabledMulti((s) => {
                      const n = new Set(s)
                      n.delete(dimension)
                      return n
                    })
                  }
                  // Clearing the age dim also clears any custom-age number so
                  // a stale value can't leak back if the user re-enables age.
                  if (isAge) {
                    onChange({ age: undefined, customAge: undefined } as Partial<PersonValue>)
                  } else {
                    onChange({ [field]: undefined } as Partial<PersonValue>)
                  }
                }
              }}
              onPick={(id) => {
                if (maxSelected <= 1) {
                  // Switching off the custom-age sentinel drops customAge so
                  // the number doesn't silently linger when an Age preset is
                  // chosen instead.
                  if (isAge && id !== "age-custom" && value.customAge !== undefined) {
                    onChange({ age: id, customAge: undefined } as Partial<PersonValue>)
                  } else {
                    onChange({ [field]: id } as Partial<PersonValue>)
                  }
                  return
                }
                if (!isMultiData) {
                  onChange({ [field]: selectedIds[0] === id ? undefined : id } as Partial<PersonValue>)
                  return
                }
                const next = togglePick(selectedIds, id, maxSelected)
                onChange({
                  [field]: next.length === 0 ? undefined : next,
                } as Partial<PersonValue>)
              }}
              onActivateMulti={(id) => onChange({ [field]: [id] } as Partial<PersonValue>)}
              onDemoteToSingle={(id) => onChange({ [field]: id } as Partial<PersonValue>)}
            />
            {isAgeCustom && (
              <div className="flex items-center gap-2 px-1 pl-6">
                <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Age (years)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  inputMode="numeric"
                  className="h-7 w-20 text-xs"
                  value={value.customAge ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === "") {
                      onChange({ customAge: undefined } as Partial<PersonValue>)
                      return
                    }
                    const n = parseInt(raw, 10)
                    if (Number.isFinite(n)) {
                      onChange({ customAge: n } as Partial<PersonValue>)
                    }
                  }}
                  placeholder="e.g. 8"
                  aria-label="Custom age in years"
                />
              </div>
            )}
          </div>
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
  /** True when stored data is currently an array (multi mode). */
  readonly isMultiData: boolean
  /** True when the user has typed into the search box. Forces the dim to
   *  render entries flat (overrides the grouped/tabbed layout) so search
   *  mode is consistent across dimensions. */
  readonly isSearching: boolean
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
  readonly onActivateMulti: (id: string) => void
  readonly onDemoteToSingle: (id: string) => void
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
  isMultiData,
  maxSelected,
  enabled,
  label,
  resolveLabel,
  resolveDescription,
  onPick,
  onActivateMulti,
  onDemoteToSingle,
}: {
  readonly dimension: PersonDimension
  readonly entry: Person
  readonly selected: boolean
  /** Position in the multi-pick array (0-based). -1 if not selected. */
  readonly selectedIndex: number
  /** True when this dimension allows multi-pick (>1 max). */
  readonly multi: boolean
  readonly isMultiData: boolean
  readonly maxSelected: number
  readonly enabled: boolean
  readonly label: string
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onPick: (id: string) => void
  readonly onActivateMulti: (id: string) => void
  readonly onDemoteToSingle: (id: string) => void
}) {
  const swatch = getPersonSwatch(entry.id)
  const icon = renderEntryIcon(dimension, entry)
  // Resolved label uses shortLabel as English fallback (compact display); when
  // a localized translation exists, it takes precedence.
  const resolvedLabel = resolveLabel(entry.id, entry.shortLabel ?? entry.label)
  const resolvedDescription = resolveDescription(entry.id, entry.description)
  return (
    <div className="relative">
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        title={enabled ? resolvedDescription : `${resolvedDescription} (click to enable ${label})`}
        onClick={() => onPick(entry.id)}
        className={cn(
          "w-full flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer",
          selected
            ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
            : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
        )}
      >
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
      {multi && selected && (
        <MultiPickBadge
          mode={isMultiData ? "multi" : "single"}
          index={selectedIndex}
          maxSelected={maxSelected}
          onActivate={() => onActivateMulti(entry.id)}
          onDemote={() => onDemoteToSingle(entry.id)}
        />
      )}
    </div>
  )
}

/**
 * Tab-style grouped picker: a horizontal row of group buttons across the top,
 * the active group's entries shown in a chip grid below. Replaces the older
 * accordion (which let multiple groups open at once and hid the user's pick
 * inside collapsed sections).
 *
 * Single-pick dims show a small pink dot on the tab containing the current
 * pick. Multi-pick dims show a numeric count badge on each tab.
 */
function TabbedEntryGrid({
  dimension,
  entries,
  checked,
  selectedIds,
  multi,
  isMultiData,
  maxSelected,
  label,
  resolveLabel,
  resolveDescription,
  onPick,
  onActivateMulti,
  onDemoteToSingle,
}: {
  readonly dimension: PersonDimension
  readonly entries: ReadonlyArray<Person>
  readonly checked: boolean
  readonly selectedIds: ReadonlyArray<string>
  readonly multi: boolean
  readonly isMultiData: boolean
  readonly maxSelected: number
  readonly label: string
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onPick: (id: string) => void
  readonly onActivateMulti: (id: string) => void
  readonly onDemoteToSingle: (id: string) => void
}) {
  const { groupOrder, byGroup } = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, Person[]>()
    for (const e of entries) {
      const g = e.group ?? "Other"
      if (!map.has(g)) {
        order.push(g)
        map.set(g, [])
      }
      map.get(g)!.push(e)
    }
    return { groupOrder: order, byGroup: map }
  }, [entries])

  // Per-group selected count for the badge / has-pick indicator on each tab.
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const id of selectedIds) {
      const g = entries.find((e) => e.id === id)?.group
      if (g) m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }, [selectedIds, entries])

  // Initial active tab: the group containing the current pick (or first
  // pick for multi). Falls back to the first group with content.
  const [activeGroup, setActiveGroup] = useState<string>(() => {
    for (const id of selectedIds) {
      const g = entries.find((e) => e.id === id)?.group
      if (g) return g
    }
    return groupOrder[0] ?? ""
  })

  // If the user picks an entry while a different tab is active (rare — the
  // chip lives inside the currently-active tab), we don't auto-jump. But if
  // the catalog reshapes (filter changes the available groups) and the
  // active tab disappears, snap to the first available group.
  const activeExists = byGroup.has(activeGroup)
  const effectiveActive = activeExists ? activeGroup : groupOrder[0] ?? ""

  const activeEntries = byGroup.get(effectiveActive) ?? []

  return (
    <div className={cn("flex flex-col gap-2 transition-opacity", !checked && "opacity-40")}>
      {/* Group tabs — underline style (active group sits on a pink underline,
          inactive groups are bare text). Reads cleaner than boxed buttons
          when there are 7+ groups stacking. */}
      <div
        role="tablist"
        aria-label={`${label} groups`}
        className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-200 dark:border-[#2D2D2D]"
      >
        {groupOrder.map((g) => {
          const c = groupCounts.get(g) ?? 0
          const active = g === effectiveActive
          const hasPick = c > 0
          return (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveGroup(g)}
              className={cn(
                "relative -mb-px inline-flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap",
                active
                  ? "border-[#ff0073] text-[#ff0073]"
                  : hasPick
                  ? "border-transparent text-[#ff0073]/80 hover:border-[#ff0073]/40 hover:text-[#ff0073]"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
              )}
            >
              <span>{compactGroupLabel(g)}</span>
              {multi && c > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-[4px] rounded-full bg-[#ff0073] text-white text-[9px] font-semibold leading-none"
                  aria-label={`${c} selected`}
                >
                  {c}
                </span>
              )}
              {!multi && hasPick && !active && (
                <span className="inline-block size-1.5 rounded-full bg-[#ff0073]" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      {/* Entries of the active group */}
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={`${label} — ${effectiveActive}`}
        className="grid grid-cols-3 gap-1.5"
      >
        {activeEntries.map((entry) => {
          const idx = selectedIds.indexOf(entry.id)
          return (
            <EntryChip
              key={entry.id}
              dimension={dimension}
              entry={entry}
              selected={checked && idx >= 0}
              selectedIndex={idx}
              multi={multi}
              isMultiData={isMultiData}
              maxSelected={maxSelected}
              enabled={checked}
              label={label}
              resolveLabel={resolveLabel}
              resolveDescription={resolveDescription}
              onPick={onPick}
              onActivateMulti={onActivateMulti}
              onDemoteToSingle={onDemoteToSingle}
            />
          )
        })}
      </div>
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
  isMultiData,
  isSearching,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
  onActivateMulti,
  onDemoteToSingle,
}: DimensionSectionProps) {
  const id = useId()
  const baseLabel = PERSON_DIMENSION_LABELS[dimension]
  const multi = maxSelected > 1
  const label = multi ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
  // Ethnicity (39 entries / 6 region groups) and Type (60+ entries spanning
  // realistic, primitive, fantasy, mythic, sci-fi, heroes, anime) get the
  // tabbed two-level picker — flat scrolling 70 entries doesn't read.
  // While the user is searching, override grouping with a flat result grid
  // so matches don't hide behind tabs.
  const useGrouped = (dimension === "ethnicity" || dimension === "type") && !isSearching
  const switchId = `${id}-${field}`
  return (
    <div className="flex flex-col gap-2 border-t-[3px] border-border/40">
      {/* Branded headline as a settings row: label on the left, Switch on
          the right, space between. Reads like a standard "section · toggle"
          control instead of a centered banner.
          border-t on the wrapper + mt-5 on the header give a clear visual
          divider with breathing room before each section title. */}
      <div className="flex items-center justify-between gap-2 px-0.5 mt-5">
        <label
          htmlFor={switchId}
          className={cn(
            "text-[18px] font-semibold uppercase tracking-wide select-none cursor-pointer transition-colors",
            checked ? "text-[#ff0073]" : "text-muted-foreground/60",
          )}
        >
          {baseLabel}
          {multi && checked && (
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              pick up to {maxSelected}
            </span>
          )}
        </label>
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={(next) => onToggle(next)}
          aria-label={`Enable ${baseLabel}`}
        />
      </div>
      {useGrouped ? (
        <TabbedEntryGrid
          dimension={dimension}
          entries={entries}
          checked={checked}
          selectedIds={selectedIds}
          multi={multi}
          isMultiData={isMultiData}
          maxSelected={maxSelected}
          label={label}
          resolveLabel={resolveLabel}
          resolveDescription={resolveDescription}
          onPick={onPick}
          onActivateMulti={onActivateMulti}
          onDemoteToSingle={onDemoteToSingle}
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
                isMultiData={isMultiData}
                maxSelected={maxSelected}
                enabled={checked}
                label={label}
                resolveLabel={resolveLabel}
                resolveDescription={resolveDescription}
                onPick={onPick}
                onActivateMulti={onActivateMulti}
                onDemoteToSingle={onDemoteToSingle}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

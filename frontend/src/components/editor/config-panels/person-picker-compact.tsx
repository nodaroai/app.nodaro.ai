"use client"

import { memo, useId, useMemo, useRef, useState } from "react"
import { ChevronDown, X } from "lucide-react"
import {
  PERSON_DIMENSION_LABELS,
  PERSON_DIMENSION_SECTIONS,
  PERSON_FIELD_BY_DIMENSION,
  getPersonLabel,
  pickIds,
  type PersonDimension,
  type PersonDimensionSection,
  type PersonValue,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useLocaleDir } from "@/lib/locale-store"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { PersonDimensionGrid, usePersonDimension } from "./person-dimension-grid"

/** The age-dimension sentinel whose selection opens a free-form number input.
 *  Sourced from the shared catalog (person.ts) — selecting it must NOT
 *  commit-and-close the popover (the user still has to type a number). */
const AGE_CUSTOM_ID = "age-custom"

/** Count how many of a section's dimensions currently hold a value. */
function selectedCountForSection(
  section: PersonDimensionSection,
  value: PersonValue,
): number {
  let n = 0
  for (const dim of section.dimensions) {
    if (pickIds(value[PERSON_FIELD_BY_DIMENSION[dim]]).length > 0) n += 1
  }
  return n
}

/**
 * The popover body for a single dimension. Calls `useLocalizedCatalog("person")`
 * once (per open popover) and threads the resolvers + per-dimension local search
 * into the shared `PersonDimensionGrid` — mirroring how `PersonPickerDetailed`
 * hosts the grid, but scoped to one dimension.
 *
 * Single-pick dimensions commit-and-close; multi-pick dimensions toggle up to
 * the cap and stay open. The age-custom sentinel is the one single-pick
 * exception: it keeps the popover open and focuses the number input.
 */
function DimensionPopoverBody({
  dimension,
  value,
  onChange,
  onRequestClose,
}: {
  readonly dimension: PersonDimension
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly onRequestClose: () => void
}) {
  const dir = useLocaleDir()
  const dimensionLabel = PERSON_DIMENSION_LABELS[dimension]
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("person")
  const { multi, field } = usePersonDimension(dimension, value, onChange)
  const [localSearch, setLocalSearch] = useState("")
  const isAge = dimension === "age"

  // Stable ref to the popover body so we can locate the age-custom number input
  // AT focus time (it mounts only after `age-custom` is picked). Querying live
  // — instead of caching the element in a ref callback — avoids a stale null
  // when the input appears on a later re-render of the same wrapper.
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Wrap the grid's onChange to drive the popover's open state:
  //  - multi-pick dims stay open (toggle up to cap),
  //  - single-pick dims commit & close,
  //  - the age-custom sentinel is the single-pick exception (keep open + focus
  //    the number input, which PersonDimensionGrid renders for the age branch).
  const handleGridChange = (patch: Partial<PersonValue>) => {
    onChange(patch)
    if (multi) return
    // A side-field-only patch (e.g. typing in the custom-age number input emits
    // `{ customAge }` with no `age` key) must NOT close — only a change to the
    // dimension's own field commits & closes. Without this, every custom-age
    // keystroke closed the popover (age-custom became unusable).
    if (!(field in patch)) return
    const picked = patch[field]
    if (isAge && picked === AGE_CUSTOM_ID) {
      // Defer one frame so the number input has mounted before we focus it.
      requestAnimationFrame(() => {
        bodyRef.current?.querySelector<HTMLInputElement>('input[type="number"]')?.focus()
      })
      return
    }
    onRequestClose()
  }

  return (
    <div ref={bodyRef} dir={dir} className="flex flex-col gap-2">
      <Input
        aria-label={`Search ${dimensionLabel.toLowerCase()}`}
        placeholder={`Search ${dimensionLabel.toLowerCase()}…`}
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        className="h-8 text-xs"
      />
      <PersonDimensionGrid
        dimension={dimension}
        value={value}
        onChange={handleGridChange}
        resolveLabel={resolveLabel}
        resolveDescription={resolveDescription}
        matches={matches}
        search={localSearch}
      />
    </div>
  )
}

/**
 * One dimension rendered as a pill that opens its option grid in a popover.
 * Unselected: ghost pill + chevron. Selected: pink-tinted pill showing the
 * field label + value (single → label, multi → "N selected") + a clear ✕.
 */
function DimensionPill({
  dimension,
  value,
  onChange,
}: {
  readonly dimension: PersonDimension
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
}) {
  const [open, setOpen] = useState(false)
  const dir = useLocaleDir()
  const dimensionLabel = PERSON_DIMENSION_LABELS[dimension]
  const { selectedIds, multi, toggleOff } = usePersonDimension(dimension, value, onChange)
  const selected = selectedIds.length > 0

  const valueLabel = selected
    ? multi && selectedIds.length > 1
      ? `${selectedIds.length} selected`
      : getPersonLabel(selectedIds[0])
    : ""

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={selected ? `${dimensionLabel}: ${valueLabel}` : `Choose ${dimensionLabel}`}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer max-w-full",
            selected
              ? "border-[#ff0073]/40 bg-[#ff0073]/10 text-[#ff0073]"
              : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] text-gray-700 dark:text-[#E2E8F0] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
          )}
        >
          {selected ? (
            <>
              <span className="uppercase tracking-wide text-[9px] font-semibold text-[#ff0073]/70 shrink-0">
                {dimensionLabel}
              </span>
              <span className="truncate">{valueLabel}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Clear ${dimensionLabel}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleOff()
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleOff()
                  }
                }}
                className="ml-0.5 inline-flex shrink-0 items-center justify-center rounded-full p-0.5 text-[#ff0073]/70 hover:bg-[#ff0073]/20 hover:text-[#ff0073] cursor-pointer"
              >
                <X className="size-3" />
              </span>
            </>
          ) : (
            <>
              <span className="truncate">{dimensionLabel}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        // [FIX 2] z-[9999] — above the z-50 of the config fullscreen modal, the
        // app-card Dialog overlay/content, and the default PopoverContent.
        className="z-[9999] w-80"
        // [FIX 4] RTL: Radix portals outside the dir-scoped parent, so re-assert
        // the user's locale direction on the portaled content.
        dir={dir}
        aria-label={`${dimensionLabel} options`}
        // [FIX 1] BLOCKER: the fullscreen panel closes on a double-click whose
        // target is a radio/checkbox tile; the popover's EntryChip tiles use
        // those roles and bubble through the React tree. Stopping it here (the
        // common ancestor of every tile) defends the fullscreen panel.
        onDoubleClick={(e) => e.stopPropagation()}
        align="start"
      >
        <DimensionPopoverBody
          dimension={dimension}
          value={value}
          onChange={onChange}
          onRequestClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** A collapsible section: header (chevron + label + counts) + a flex-wrap of
 *  dimension pills. Open-state is owned by the parent (so collapse/expand-all
 *  can drive every section at once). */
function CompactSection({
  section,
  value,
  onChange,
  open,
  onToggle,
}: {
  readonly section: PersonDimensionSection
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly open: boolean
  readonly onToggle: () => void
}) {
  const bodyId = useId()
  const count = selectedCountForSection(section, value)
  const total = section.dimensions.length

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex items-center gap-2 px-0.5 py-1.5 text-left"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {section.label}
        </span>
        {count > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-[5px] rounded-full bg-[#ff0073]/15 text-[#ff0073] text-[10px] font-semibold leading-none"
            aria-hidden="true"
          >
            {count}
          </span>
        )}
        <span className="text-[10px] font-normal text-muted-foreground">
          {count > 0 ? `${count}/${total}` : total}
        </span>
        {count > 0 && <span className="sr-only">{count} selected</span>}
      </button>
      {open && (
        <div id={bodyId} className="flex flex-wrap gap-2 px-0.5 pb-2 pt-1">
          {section.dimensions.map((dim) => (
            <DimensionPill key={dim} dimension={dim} value={value} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}

interface PersonPickerCompactProps {
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly className?: string
}

/**
 * Compact Person picker: a grouped grid of small "pills" (one per dimension)
 * inside collapsible sections, each pill opening the rich option grid in a
 * popover. A section starts open if any of its dimensions hold a value; if
 * nothing is selected anywhere, the first section opens. A header
 * "Collapse all / Expand all" control toggles every section at once (the
 * section axis — distinct from the wrapper's Compact/Detailed mode toggle).
 *
 * Layout-inspired by studio.nodaro.ai's Subject builder; the popover-per-pill,
 * single-commit-close, and age-custom-keep-open behaviors are net-new here.
 * Accent is the hardcoded `#ff0073` (never a `primary` token).
 */
export const PersonPickerCompact = memo(function PersonPickerCompact({
  value,
  onChange,
  className,
}: PersonPickerCompactProps) {
  // Ephemeral open-state, copy-on-write. Seeded lazily: open every section that
  // holds a value; if nothing is selected anywhere, open the first section.
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => {
    const initial = new Set<string>()
    for (const section of PERSON_DIMENSION_SECTIONS) {
      if (selectedCountForSection(section, value) > 0) initial.add(section.label)
    }
    if (initial.size === 0 && PERSON_DIMENSION_SECTIONS.length > 0) {
      initial.add(PERSON_DIMENSION_SECTIONS[0].label)
    }
    return initial
  })

  const allOpen = useMemo(
    () => PERSON_DIMENSION_SECTIONS.every((s) => openSections.has(s.label)),
    [openSections],
  )

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const toggleAll = () => {
    setOpenSections(
      allOpen ? new Set<string>() : new Set(PERSON_DIMENSION_SECTIONS.map((s) => s.label)),
    )
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Attributes
        </span>
        <button
          type="button"
          aria-label={allOpen ? "Collapse all sections" : "Expand all sections"}
          onClick={toggleAll}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {PERSON_DIMENSION_SECTIONS.map((section) => (
        <CompactSection
          key={section.label}
          section={section}
          value={value}
          onChange={onChange}
          open={openSections.has(section.label)}
          onToggle={() => toggleSection(section.label)}
        />
      ))}
    </div>
  )
})

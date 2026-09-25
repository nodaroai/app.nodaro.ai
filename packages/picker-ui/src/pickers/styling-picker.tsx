"use client"

import { memo, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { Search } from "lucide-react"
import { STYLINGS as BASE_STYLINGS, STYLING_FIELD_BY_DIMENSION, MAX_SELECTED_BY_STYLING_DIMENSION, type Styling, type StylingDimension, type StylingValue } from "@nodaro/prompts"
import { pickIds, togglePick } from "@nodaro/shared"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { useCuratedEntries } from "../curated.js"
import { characterArtShape, characterArtUrl, type CharacterArtShape } from "../icons/character-art"
import { PickerTopicHeading, PickerTopicNav, useTopicJump } from "./picker-topics"
import { StylingDimensionSection } from "./styling-dimension-section"
import { STYLING_TOPICS } from "./styling-topics"

interface StylingPickerProps {
  readonly value: StylingValue
  readonly onChange: (patch: Partial<StylingValue>) => void
  readonly className?: string
  /** True when the subject the styling applies to is a minor. Hides
   *  `adultOnly` styling tiles. Callers that already gate on the minor-age
   *  floor elsewhere (e.g. the platform config panel via Layer 2) can omit
   *  this — it defaults to false, i.e. no additional hiding here. */
  readonly subjectMinor?: boolean
}

type Catalog = ReturnType<typeof useLocalizedCatalog>

const pickedIn = (value: StylingValue, dimension: StylingDimension): ReadonlyArray<string> =>
  pickIds(value[STYLING_FIELD_BY_DIMENSION[dimension]])

interface StylingDimensionRowProps {
  readonly dimension: StylingDimension
  readonly entries: ReadonlyArray<Styling>
  readonly firstEntryId: string | undefined
  readonly photoShape: CharacterArtShape | undefined
  readonly value: StylingValue
  readonly onChange: (patch: Partial<StylingValue>) => void
  readonly catalog: Catalog
  readonly enabledMulti: ReadonlySet<StylingDimension>
  readonly setEnabledMulti: Dispatch<SetStateAction<Set<StylingDimension>>>
}

/** One setting wired to the value: enable switch, single / multi picking, `+` badge. */
function StylingDimensionRow({ dimension, entries, firstEntryId, photoShape, value, onChange, catalog, enabledMulti, setEnabledMulti }: StylingDimensionRowProps) {
  const field = STYLING_FIELD_BY_DIMENSION[dimension]
  const raw = value[field]
  const selectedIds = pickIds(raw)
  const maxSelected = MAX_SELECTED_BY_STYLING_DIMENSION[dimension] ?? 1
  const isMultiCapable = maxSelected > 1
  // Runtime mode follows data shape: array → multi, anything else → single.
  // First pick stays single (string); pressing the `+` badge promotes to
  // multi (array) so further picks accumulate up to maxSelected.
  const isMultiData = Array.isArray(raw)
  const checked = isMultiCapable ? enabledMulti.has(dimension) || selectedIds.length > 0 : selectedIds.length > 0
  const write = (next: string | ReadonlyArray<string> | undefined) => onChange({ [field]: next } as Partial<StylingValue>)
  const setEnabled = (on: boolean) =>
    setEnabledMulti((s) => {
      const n = new Set(s)
      if (on) n.add(dimension)
      else n.delete(dimension)
      return n
    })

  return (
    <StylingDimensionSection
      dimension={dimension}
      entries={entries}
      checked={checked}
      selectedIds={selectedIds}
      maxSelected={maxSelected}
      isMultiData={isMultiData}
      photoShape={photoShape}
      resolveLabel={catalog.resolveLabel}
      resolveDescription={catalog.resolveDescription}
      onToggle={(next) => {
        if (isMultiCapable) setEnabled(next)
        if (!next) write(undefined)
        else if (!isMultiCapable && firstEntryId) write(firstEntryId)
      }}
      onPick={(id) => {
        if (maxSelected <= 1) return write(id)
        // Single mode in a multi-capable section: replace or clear.
        if (!isMultiData) return write(selectedIds[0] === id ? undefined : id)
        const next = togglePick(selectedIds, id, maxSelected)
        write(next.length === 0 ? undefined : next)
      }}
      onActivateMulti={(id) => write([id])}
      onDemoteToSingle={(id) => write(id)}
    />
  )
}

/**
 * The Styling picker, open by topic (Beauty & Hair, Accessories, Wardrobe,
 * Fabric & Fit) — the same shape as the Person picker: every setting laid out
 * with its options under its topic, jump buttons at the top that only scroll,
 * and a search across every topic.
 */
export const StylingPicker = memo(function StylingPicker({ value, onChange, className, subjectMinor }: StylingPickerProps) {
  // Curated view of the bundled catalog: filtered to ids this deployment
  // offers, relabelled where a pack rewrote an entry. Subscribed, so a late
  // registration re-renders. Identity-equal to the base on mainline.
  const STYLINGS = useCuratedEntries("styling", BASE_STYLINGS)
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  tracked here so the section stays "checked" without forcing a pick. */
  const [enabledMulti, setEnabledMulti] = useState<Set<StylingDimension>>(new Set())
  const catalog = useLocalizedCatalog("styling")
  const { sectionRef, headingId, jump } = useTopicJump()

  const byDimension = useMemo(() => {
    const map = new Map<StylingDimension, Styling[]>()
    for (const styling of STYLINGS) {
      if (subjectMinor && styling.adultOnly) continue
      if (!catalog.matches(styling.id, styling.label, styling.description, query)) continue
      map.set(styling.dimension, [...(map.get(styling.dimension) ?? []), styling])
    }
    return map
  }, [query, catalog.matches, subjectMinor, STYLINGS])

  // Photo tiles for a setting when any of its options has a photo. Read from
  // the whole catalog, not the search results, so the layout never flips while
  // the user types.
  const photoShapes = useMemo(() => {
    const withArt = new Set(STYLINGS.filter((s) => characterArtUrl("styling", s.id) !== undefined).map((s) => s.dimension))
    return new Map([...withArt].map((dim) => [dim, characterArtShape("styling", dim)] as const))
  }, [STYLINGS])

  const counts = new Map(STYLING_TOPICS.map((t) => [t.label, t.dimensions.filter((d) => pickedIn(value, d).length > 0).length] as const))
  const shown = STYLING_TOPICS.map((topic) => ({
    topic,
    dimensions: query ? topic.dimensions.filter((d) => (byDimension.get(d)?.length ?? 0) > 0) : topic.dimensions,
  })).filter((t) => t.dimensions.length > 0)

  return (
    <div className={cn("@container flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search styling"
          placeholder="Search styling"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-9 text-[13px]"
        />
      </div>
      {!query && <PickerTopicNav label="Styling topics" topics={STYLING_TOPICS} counts={counts} onJump={jump} />}
      {query && shown.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">No styling matches &quot;{query}&quot;</div>
      )}
      {shown.map(({ topic, dimensions }) => (
        <section key={topic.label} aria-labelledby={headingId(topic.label)} ref={sectionRef(topic.label)} className="flex scroll-mt-2 flex-col gap-1.5">
          <PickerTopicHeading topic={topic} count={counts.get(topic.label) ?? 0} id={headingId(topic.label)} />
          {dimensions.map((dimension) => (
            <StylingDimensionRow
              key={dimension}
              dimension={dimension}
              entries={byDimension.get(dimension) ?? []}
              firstEntryId={STYLINGS.find((s) => s.dimension === dimension)?.id}
              photoShape={photoShapes.get(dimension)}
              value={value}
              onChange={onChange}
              catalog={catalog}
              enabledMulti={enabledMulti}
              setEnabledMulti={setEnabledMulti}
            />
          ))}
        </section>
      ))}
    </div>
  )
})

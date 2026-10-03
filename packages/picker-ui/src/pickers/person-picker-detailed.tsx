"use client"

import { memo, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { Search } from "lucide-react"
import { getPerson, getRegisteredPeople, getRegisteredPersonFieldByDimension, getPersonDimensionLimit, type Person, type PersonDimension, type PersonValue } from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"
import { Input } from "../ui/input"
import { cn } from "../lib/cn"
import { useLocalizedCatalog } from "../i18n"
import { PersonDimensionGrid } from "./person-dimension-grid"
import { PickerTopicHeading, PickerTopicNav, useTopicJump } from "./picker-topics"
import { personTopics, type PersonTopic } from "./person-topics"
import { useMinorAgeFloor } from "./person-minor-floor"

interface PersonPickerDetailedProps {
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly className?: string
}

type Catalog = ReturnType<typeof useLocalizedCatalog>

const fieldOf = (dimension: PersonDimension): keyof PersonValue =>
  getRegisteredPersonFieldByDimension()[dimension] as keyof PersonValue

/** How many of a topic's dimensions hold a pick the catalog knows (a stale id lights nothing). */
function pickedCount(topic: PersonTopic, value: PersonValue): number {
  return topic.dimensions.filter((dim) => pickIds(value[fieldOf(dim)]).some((id) => getPerson(id) !== undefined)).length
}

/** Dimensions with an entry matching the search — the registered set, so a deployment's person packs count. */
function useMatchingDimensions(query: string, matches: Catalog["matches"], minor: boolean): ReadonlySet<string> {
  return useMemo(() => {
    const found = new Set<string>()
    if (!query) return found
    for (const person of getRegisteredPeople() as readonly Person[]) {
      if (minor && person.adultOnly) continue
      if (matches(person.id, person.label, person.description, query)) found.add(person.dimension)
    }
    return found
  }, [query, matches, minor])
}

interface DetailedDimensionProps {
  readonly dimension: PersonDimension
  readonly value: PersonValue
  readonly onChange: (patch: Partial<PersonValue>) => void
  readonly catalog: Catalog
  readonly query: string
  readonly enabledMulti: ReadonlySet<PersonDimension>
  readonly setEnabledMulti: Dispatch<SetStateAction<Set<PersonDimension>>>
}

/** One setting of the open view: its section, switch and option grid. */
function DetailedDimension({ dimension, value, onChange, catalog, query, enabledMulti, setEnabledMulti }: DetailedDimensionProps) {
  const selectedIds = pickIds(value[fieldOf(dimension)])
  const isMultiCapable = getPersonDimensionLimit(dimension) > 1
  const checked = isMultiCapable ? enabledMulti.has(dimension) || selectedIds.length > 0 : selectedIds.length > 0
  return (
    <PersonDimensionGrid
      dimension={dimension}
      value={value}
      onChange={onChange}
      resolveLabel={catalog.resolveLabel}
      resolveDescription={catalog.resolveDescription}
      matches={catalog.matches}
      search={query}
      enabled={checked}
      onToggleEnabled={(next) => {
        // Single-pick toggle-on (select the first id) and every value clear
        // (age-aware) happen inside the grid's Switch; this tracks the
        // enabled state of multi-pick sections that hold no pick yet.
        if (!isMultiCapable) return
        setEnabledMulti((s) => {
          const n = new Set(s)
          if (next) n.add(dimension)
          else n.delete(dimension)
          return n
        })
      }}
    />
  )
}

/**
 * The open Person picker (DETAILED view, the default): every setting laid out
 * with its options, grouped under its topic (Identity, Body, Face, Hair,
 * Skin & Eyes, Features) — the same shape as the music pickers. Nothing is
 * folded away; the topic buttons at the top only scroll to a topic.
 *
 * Each setting is an independent section with its own switch; the user can
 * enable any combination and pick one entry per setting (up to the cap where
 * a setting allows several). Searching looks across every topic and keeps
 * only the matching settings.
 */
export const PersonPickerDetailed = memo(function PersonPickerDetailed({ value, onChange, className }: PersonPickerDetailedProps) {
  const [query, setQuery] = useState("")
  /** Multi-select dims (max > 1) intentionally start empty when toggled on —
   *  we track explicit enable here so the section stays "checked" without
   *  forcing a default selection. */
  const [enabledMulti, setEnabledMulti] = useState<Set<PersonDimension>>(new Set())
  const catalog = useLocalizedCatalog("person")
  const { sectionRef, headingId, jump } = useTopicJump()
  const minor = useMinorAgeFloor(value, onChange)
  const matching = useMatchingDimensions(query, catalog.matches, minor)

  const topics = personTopics()
  const counts = new Map(topics.map((t) => [t.label, pickedCount(t, value)] as const))
  const shown = topics
    .map((topic) => ({ topic, dimensions: query ? topic.dimensions.filter((d) => matching.has(d)) : topic.dimensions }))
    .filter((t) => t.dimensions.length > 0)

  return (
    <div className={cn("@container flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search person"
          placeholder="Search person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-9 text-[13px]"
        />
      </div>
      {!query && <PickerTopicNav label="Person topics" topics={topics} counts={counts} onJump={jump} />}
      {query && shown.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">No person attributes match &quot;{query}&quot;</div>
      )}
      {shown.map(({ topic, dimensions }) => (
        <section key={topic.label} aria-labelledby={headingId(topic.label)} ref={sectionRef(topic.label)} className="flex scroll-mt-2 flex-col gap-1.5">
          <PickerTopicHeading topic={topic} count={counts.get(topic.label) ?? 0} id={headingId(topic.label)} />
          {dimensions.map((dimension) => (
            <DetailedDimension
              key={dimension}
              dimension={dimension}
              value={value}
              onChange={onChange}
              catalog={catalog}
              query={query}
              enabledMulti={enabledMulti}
              setEnabledMulti={setEnabledMulti}
            />
          ))}
        </section>
      ))}
    </div>
  )
})

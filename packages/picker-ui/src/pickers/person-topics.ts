import { PERSON_DIMENSION_SECTIONS, getRegisteredPersonDimensionOrder, type PersonDimension } from "@nodaro/prompts"
import type { PickerTopic } from "./picker-topics"

export interface PersonTopic extends PickerTopic {
  readonly dimensions: ReadonlyArray<PersonDimension>
}

/** Label of the topic that collects registered dimensions no section lists. */
export const PERSON_MORE_TOPIC = "More"

/**
 * The Person topics (Identity, Body, Face, …) in section order, each holding
 * only dimensions this deployment registers. A dimension a person pack adds
 * outside every section lands in a trailing "More" topic, so no registered
 * dimension is ever unreachable.
 */
export function personTopics(): ReadonlyArray<PersonTopic> {
  const registered = getRegisteredPersonDimensionOrder() as ReadonlyArray<string>
  const registeredSet = new Set(registered)
  const listed = new Set<string>(PERSON_DIMENSION_SECTIONS.flatMap((s) => s.dimensions))
  const topics: PersonTopic[] = PERSON_DIMENSION_SECTIONS.map((s) => ({
    label: s.label,
    dimensions: s.dimensions.filter((d) => registeredSet.has(d)),
  })).filter((t) => t.dimensions.length > 0)
  const extra = registered.filter((d) => !listed.has(d)) as PersonDimension[]
  return extra.length > 0 ? [...topics, { label: PERSON_MORE_TOPIC, dimensions: extra }] : topics
}

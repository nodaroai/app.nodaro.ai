import { PERSON_DIMENSION_SECTIONS, PERSON_FIELD_BY_DIMENSION } from "./person.js"
import { STYLING_DIMENSION_SECTIONS, STYLING_FIELD_BY_DIMENSION } from "./styling.js"

/** One of the topics the editor groups a catalog's settings under, as node-data fields. */
export interface CatalogTopic {
  readonly label: string
  readonly fields: ReadonlyArray<string>
}

/**
 * The editor's topics for a catalog (Person, Styling), in order, with their
 * settings as node-data fields — or undefined for every other catalog. Kept
 * out of the picker-catalogs funnel on purpose: the topic lists are layout
 * metadata, not catalog entries.
 */
export function catalogTopics(catalogId: string): ReadonlyArray<CatalogTopic> | undefined {
  if (catalogId === "person") {
    return PERSON_DIMENSION_SECTIONS.map((s) => ({ label: s.label, fields: s.dimensions.map((d) => PERSON_FIELD_BY_DIMENSION[d] as string) }))
  }
  if (catalogId === "styling") {
    return STYLING_DIMENSION_SECTIONS.map((s) => ({ label: s.label, fields: s.dimensions.map((d) => STYLING_FIELD_BY_DIMENSION[d] as string) }))
  }
  return undefined
}

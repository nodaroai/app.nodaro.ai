import {
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  applyMinorAgeFloorToPickerValues,
  getPerson,
  getStyling,
  isMinorAge,
  type PersonDimension,
  type PersonValue,
  type StylingDimension,
  type StylingValue,
} from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"

/** One setting shown on a character node card: its dimension and every picked id, in order. */
export interface CardPick<D extends string> {
  readonly dimension: D
  readonly entryIds: ReadonlyArray<string>
}

/**
 * What the Person card shows: the picks the catalog knows, in dimension order.
 * For a minor, the same floor that strips adult-only picks from the prompt
 * strips them here too (and so their photos), whatever wrote the data — an
 * import, the API, a template. The floor returns a full copy WITHOUT the
 * dropped fields, so it is read as is, never spread over the data.
 */
export function personCardPicks(data: PersonValue): ReadonlyArray<CardPick<PersonDimension>> {
  const shown = isMinorAge(data) ? (applyMinorAgeFloorToPickerValues({ person: data }).person as PersonValue) : data
  return PERSON_DIMENSION_ORDER.flatMap((dimension) => {
    const entryIds = pickIds(shown[PERSON_FIELD_BY_DIMENSION[dimension]]).filter((id) => getPerson(id) !== undefined)
    return entryIds.length > 0 ? [{ dimension, entryIds }] : []
  })
}

/** What the Styling card shows: every setting with a pick, multi-pick settings (headwear, jewelry, hair state, wardrobe state) included. */
export function stylingCardPicks(data: StylingValue): ReadonlyArray<CardPick<StylingDimension>> {
  return STYLING_DIMENSION_ORDER.flatMap((dimension) => {
    const entryIds = pickIds(data[STYLING_FIELD_BY_DIMENSION[dimension]]).filter((id) => getStyling(id) !== undefined)
    return entryIds.length > 0 ? [{ dimension, entryIds }] : []
  })
}

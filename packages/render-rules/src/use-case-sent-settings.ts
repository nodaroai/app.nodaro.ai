/**
 * Which of a use-case node's settings a run sends its type's route — both
 * engines' one rule (decided 2026-10-16, for the editor and for empty values
 * 2026-10-19): an unset setting is not sent (the route takes its default); a
 * null is sent only where the type's body takes one (a None that is not the
 * default); an empty string only where the body takes one (free text: an
 * empty instruction); any other null or empty value a node holds (an agent's
 * or an import's write, a cleared choice) is left out, so the route takes its
 * default instead of refusing the run; anything else is sent as held. Which
 * settings take a null or an empty string comes from the tables gen:skills
 * renders from the bodies themselves (the editor cannot import them). Pure.
 */
import { USE_CASE_EMPTY_SETTINGS, USE_CASE_NULL_SETTINGS } from "./generated/use-case-sent-settings"

const listed = (table: Readonly<Record<string, ReadonlyArray<string>>>, type: string, key: string): boolean =>
  Object.hasOwn(table, type) && table[type]!.includes(key)

/** Whether `type`'s body takes a null for `key` (rendered from the body). */
export function usecaseSettingTakesNull(type: string, key: string): boolean {
  return listed(USE_CASE_NULL_SETTINGS, type, key)
}

/** Whether `type`'s body takes an empty string for `key` (rendered from the body). */
export function usecaseSettingTakesEmpty(type: string, key: string): boolean {
  return listed(USE_CASE_EMPTY_SETTINGS, type, key)
}

/** What a body takes of the two values a node may hold that a body may refuse. */
export interface UseCaseBodyTakes {
  readonly null: (key: string) => boolean
  readonly empty: (key: string) => boolean
}

/**
 * The settings a run sends, in `settingKeys` order (its type's descriptor).
 * `takes` defaults to the rendered tables; the server passes its bodies' own
 * answers (the tables are held equal to them by a test).
 */
export function usecaseSentSettings(
  type: string,
  settingKeys: readonly string[],
  data: Readonly<Record<string, unknown>>,
  takes: UseCaseBodyTakes = { null: (key) => usecaseSettingTakesNull(type, key), empty: (key) => usecaseSettingTakesEmpty(type, key) },
): Record<string, unknown> {
  const sent = (k: string): boolean => {
    const v = data[k]
    if (v === undefined) return false
    if (v === null) return takes.null(k)
    if (v === "") return takes.empty(k)
    return true
  }
  return Object.fromEntries(settingKeys.filter(sent).map((k) => [k, data[k]]))
}

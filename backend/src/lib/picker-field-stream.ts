import { FLOORED_PICKER_KEYS, getAdultOnlyIds } from "@nodaro/prompts"
import { createIncrementalJsonParser } from "./incremental-json.js"

/**
 * One picker detail the analyzer has finished writing, in the analyzer's own
 * coordinates: `pickerJson[picker][dimension]`, the shape describe-to-picker
 * answers with.
 */
export interface PickerFieldEvent {
  /** `<picker>.<dimension>`, e.g. `person.hair-color`. */
  field: string
  value: string | string[]
}

export interface PickerFieldStream {
  /** Feed the next fragment of the analyzer's tool-input JSON. */
  push(partialJson: string): void
}

function leafValue(value: unknown): string | string[] | null {
  if (typeof value === "string") return value.length > 0 ? value : null
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) return value as string[]
  return null
}

/**
 * Turn the picker analyzer's streamed tool input into one event per detail,
 * each sent the moment the model has finished writing it, and never one
 * holding an id the minor-age floor could remove.
 *
 * The floor (`applyMinorAgeFloorToPickerValues`) runs on the FINAL answer:
 * when its person section describes a minor, it strips every adult-only id
 * from the floored pickers' values. Which answer is final is not known while
 * this stream runs. A correction retry can replace the streamed attempt, and
 * the model can rewrite a section (JSON keeps the last one), so no reading of
 * the streamed person section can say whether the floor will fire. So the
 * rule does not depend on it:
 *
 * - A value with no id the floor strips is sent at once. The floor can never
 *   remove it, whatever the age and whichever attempt wins.
 * - A value holding an adult-only id is never sent. It arrives in the
 *   caller's final, validated and floored answer, if the floor keeps it.
 *
 * "Which ids the floor strips, in which pickers" is read from the floor
 * module's own exports (its drop set and its picker keys); a guard test pins
 * this predicate against the floor itself for every real catalog id.
 *
 * Streamed values are provisional: the final answer is authoritative and may
 * differ (a correction retry, a value the schema rejects, a multi-pick over
 * its cap). This stream only promises never to show a value the floor would
 * take away.
 */
export function createPickerFieldStream(opts: {
  targetPickers: readonly string[]
  onField: (event: PickerFieldEvent) => void
}): PickerFieldStream {
  const targets = new Set(opts.targetPickers)
  const flooredPickers: ReadonlySet<string> = new Set(FLOORED_PICKER_KEYS)
  const adultOnlyIds = getAdultOnlyIds()
  const sent = new Set<string>()

  function floorCanStrip(picker: string, value: string | string[]): boolean {
    if (!flooredPickers.has(picker)) return false
    const ids = typeof value === "string" ? [value] : value
    return ids.some((id) => adultOnlyIds.has(id))
  }

  const parser = createIncrementalJsonParser((path, value) => {
    if (path.length !== 2) return
    const [picker, dimension] = path
    if (typeof picker !== "string" || typeof dimension !== "string" || !targets.has(picker)) return
    const leaf = leafValue(value)
    if (leaf === null || floorCanStrip(picker, leaf)) return
    const field = `${picker}.${dimension}`
    if (sent.has(field)) return
    sent.add(field)
    opts.onField({ field, value: leaf })
  })

  return {
    push(partialJson: string): void {
      parser.push(partialJson)
    },
  }
}

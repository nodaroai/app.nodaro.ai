/**
 * What a node unit's SIDE outputs hand on after the node ran once per upstream
 * item (decided 2026-11-11: row-aligned; tools/units/README.md "A worker unit's
 * media take and its side outputs"). The take pip lists the batch, one take per
 * row; beside it every list output hands on EVERY row's files, row by row, and
 * a JSON (look) output that declares `alignedWith: <list output id>` hands on
 * every row's entries in the same order, each entry carrying the row it came
 * from (`row`, 0-based: the fan-out row, the index of its take in the batch's
 * `listResults` / `__listResults`). A row that made none contributes nothing,
 * so `row` is a row index, never a position. Each row's take keeps its own
 * side outputs, untagged — what one run of it made.
 *
 * One rule for both engines: the server's fan-out output
 * (backend workers/fan-out-result.ts) and the editor's canvas run once per
 * item (list-execution.ts, over the batch's takes). The server-run lanes of
 * the editor land the server's result as it is. Pure, with no node type in it:
 * each caller passes the unit's own output handles.
 */

/** The part of a unit output handle the rule reads (both kits' UnitOutputHandle satisfy it). */
interface BatchOutputHandle {
  readonly id: string
  readonly kind: string
  readonly list?: true
  /** A look output only: the list output its entries line up with, one for one. */
  readonly alignedWith?: string
}

/**
 * One row's side outputs, by output id, as a server node output carries them:
 * a list output's files (`unitLists`), a JSON output's value — its JSON string,
 * or the value itself (`unitOutputs`) — and how many of a list output's items
 * the run could not store (`unitListsNotSaved`).
 */
export interface UnitSideOutputsRow {
  readonly unitLists?: Readonly<Record<string, unknown>>
  readonly unitOutputs?: Readonly<Record<string, unknown>>
  readonly unitListsNotSaved?: Readonly<Record<string, unknown>>
}

/** The batch's side outputs, in the same carrier: each JSON output as the JSON string a wire carries. A key is absent when no row made a value. */
export interface UnitBatchSideOutputs {
  readonly unitLists?: Readonly<Record<string, readonly string[]>>
  readonly unitOutputs?: Readonly<Record<string, string>>
  readonly unitListsNotSaved?: Readonly<Record<string, number>>
}

/** The key each entry of a row-aligned JSON output carries after a batch: the row it came from. */
export const UNIT_BATCH_ROW_KEY = "row"

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v)

/** `carrier[key]` when the carrier is an object that holds the key. */
const own = (carrier: unknown, key: string): unknown => (isRecord(carrier) && Object.hasOwn(carrier, key) ? carrier[key] : undefined)

/** A list output's files: the non-empty strings of an array, in order. */
const listItems = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [])

/** A JSON output's value as a wire carries it: a string as stored, any other value serialised; null, undefined and "" are no value. */
function jsonString(v: unknown): string | undefined {
  if (typeof v === "string") return v === "" ? undefined : v
  return v === undefined || v === null ? undefined : JSON.stringify(v)
}

/** A JSON output's value: a string holding a JSON object or array is that object or array; any other value as it is. */
function jsonValue(v: string): unknown {
  try {
    const parsed: unknown = JSON.parse(v)
    return typeof parsed === "object" && parsed !== null ? parsed : v
  } catch {
    return v
  }
}

/** A JSON value's entries: an array's elements (null and undefined skipped); any other value is one entry. */
const entriesOf = (value: unknown): unknown[] => (Array.isArray(value) ? value.filter((e) => e !== undefined && e !== null) : [value])

/** An entry with its row: an object keeps its keys and gains `row` (over one it carried); any other entry becomes `{ value, row }`. */
const withRow = (entry: unknown, row: number): Record<string, unknown> =>
  isRecord(entry) ? { ...entry, [UNIT_BATCH_ROW_KEY]: row } : { value: entry, [UNIT_BATCH_ROW_KEY]: row }

/** A not-stored count: a whole number from 0. */
const countOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)

/**
 * The side outputs of a run once per upstream item, from its rows' own
 * (`rows[i]` is row i's — null or undefined for a row that made none, a
 * failed row included):
 *   - a list output: every row's files, row by row; absent when no row made one;
 *   - its not-stored count: the sum of the rows' counts; absent when no row reported one;
 *   - a JSON output aligned with a list output (`alignedWith`): every row's
 *     entries, row by row, each tagged with its row (`UNIT_BATCH_ROW_KEY`) —
 *     an array's elements, any other value one entry; "[]" when the rows that
 *     made a value made no entry (an empty JSON list is a value); absent when
 *     no row made a value;
 *   - any other JSON output: the first row's (in row order) that made a value.
 */
export function unitBatchSideOutputs(
  outputs: ReadonlyArray<BatchOutputHandle>,
  rows: ReadonlyArray<UnitSideOutputsRow | null | undefined>,
): UnitBatchSideOutputs {
  const listIds = new Set(outputs.filter((h) => h.list === true).map((h) => h.id))
  const unitLists: Record<string, string[]> = {}
  const unitListsNotSaved: Record<string, number> = {}
  const unitOutputs: Record<string, string> = {}
  for (const h of outputs) {
    if (h.list === true) {
      const items = rows.flatMap((r) => listItems(own(r?.unitLists, h.id)))
      if (items.length > 0) unitLists[h.id] = items
      const counts = rows.flatMap((r) => {
        const c = countOf(own(r?.unitListsNotSaved, h.id))
        return c === undefined ? [] : [c]
      })
      if (counts.length > 0) unitListsNotSaved[h.id] = counts.reduce((a, b) => a + b, 0)
    } else if (h.kind === "look") {
      const values = rows.map((r) => jsonString(own(r?.unitOutputs, h.id)))
      if (h.alignedWith !== undefined && listIds.has(h.alignedWith)) {
        if (values.every((v) => v === undefined)) continue
        const entries = values.flatMap((v, row) => (v === undefined ? [] : entriesOf(jsonValue(v)).map((e) => withRow(e, row))))
        unitOutputs[h.id] = JSON.stringify(entries)
      } else {
        const first = values.find((v) => v !== undefined)
        if (first !== undefined) unitOutputs[h.id] = first
      }
    }
  }
  return {
    ...(Object.keys(unitLists).length > 0 ? { unitLists } : {}),
    ...(Object.keys(unitOutputs).length > 0 ? { unitOutputs } : {}),
    ...(Object.keys(unitListsNotSaved).length > 0 ? { unitListsNotSaved } : {}),
  }
}

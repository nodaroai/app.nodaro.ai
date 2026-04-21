/** Pure sort helper shared by the frontend DAG executor and the backend
 *  orchestrator. Contract: reorder stringified list items (as produced by
 *  `collectUpstreamListItems` peers) by an optional dot-path field, with
 *  Auto/Text/Number/Date comparison and asc/desc direction. Items whose
 *  key is missing, empty, or uncoerceable under the chosen type are always
 *  appended last — regardless of direction. */

import { evaluateJsonPath } from "./json-path.js"
import { tryParseJson } from "./filter-condition.js"

export type SortType = "auto" | "text" | "number" | "date"
export type SortDirection = "asc" | "desc"

export interface SortListOptions {
  field: string
  sortType: SortType
  direction: SortDirection
}

// Natural numeric-aware, case-insensitive locale compare. Declared once so
// both the Text branch and the Auto fallback reuse the same Collator.
const textCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
})

interface KeyedItem {
  item: string
  key: number | string
  keyKind: "number" | "text" | "invalid"
}

function extractRawKey(item: string, field: string): unknown {
  if (field === "") return item
  const parsed = tryParseJson(item)
  const matches = evaluateJsonPath(parsed, field)
  return matches.length > 0 ? matches[0] : undefined
}

function isMissing(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === "string" && v.trim() === "") return true
  return false
}

function toNumberKey(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v === "boolean") return v ? 1 : 0
  if (typeof v === "string") {
    const trimmed = v.trim()
    if (trimmed === "") return undefined
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function toDateKey(v: unknown): number | undefined {
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isFinite(t) ? t : undefined
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v === "string") {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : undefined
  }
  return undefined
}

function coerceKey(raw: unknown, sortType: SortType): Pick<KeyedItem, "key" | "keyKind"> {
  if (isMissing(raw)) return { key: "", keyKind: "invalid" }

  if (sortType === "number") {
    const n = toNumberKey(raw)
    return n === undefined
      ? { key: "", keyKind: "invalid" }
      : { key: n, keyKind: "number" }
  }

  if (sortType === "date") {
    const d = toDateKey(raw)
    return d === undefined
      ? { key: "", keyKind: "invalid" }
      : { key: d, keyKind: "number" }
  }

  if (sortType === "text") {
    return { key: typeof raw === "string" ? raw : JSON.stringify(raw), keyKind: "text" }
  }

  // auto: try number → date → text.
  const asNum = toNumberKey(raw)
  if (asNum !== undefined) return { key: asNum, keyKind: "number" }
  const asDate = toDateKey(raw)
  if (asDate !== undefined) return { key: asDate, keyKind: "number" }
  return { key: typeof raw === "string" ? raw : JSON.stringify(raw), keyKind: "text" }
}

export function sortListItems(items: readonly string[], opts: SortListOptions): string[] {
  const { field, sortType, direction } = opts
  const keyed: KeyedItem[] = items.map((item) => {
    const raw = extractRawKey(item, field)
    const { key, keyKind } = coerceKey(raw, sortType)
    return { item, key, keyKind }
  })

  const sortable = keyed.filter((k) => k.keyKind !== "invalid")
  const invalid = keyed.filter((k) => k.keyKind === "invalid")

  const factor = direction === "desc" ? -1 : 1
  // Array.prototype.sort is guaranteed stable since ES2019 — equal keys
  // preserve their relative input order.
  sortable.sort((a, b) => {
    if (a.keyKind === "number" && b.keyKind === "number") {
      return ((a.key as number) - (b.key as number)) * factor
    }
    return textCollator.compare(String(a.key), String(b.key)) * factor
  })

  return [...sortable.map((k) => k.item), ...invalid.map((k) => k.item)]
}

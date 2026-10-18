/**
 * Pure helpers for the cache-key guards (header-query-keys, balance-refresh
 * census): where an expression is used as a TanStack Query key, and whether
 * that use DEFINES a cache entry (a query, a write) or only TARGETS entries by
 * prefix (an invalidation). Reads no file; the tests pass source text in.
 */

/** Calls whose key names the entry they read or write. */
export const ENTRY_CALLS = [
  "useQuery",
  "useSuspenseQuery",
  "useInfiniteQuery",
  "useSuspenseInfiniteQuery",
  "useQueries",
  "queryOptions",
  "infiniteQueryOptions",
  "fetchQuery",
  "prefetchQuery",
  "ensureQueryData",
  "fetchInfiniteQuery",
  "prefetchInfiniteQuery",
  "setQueryData",
  "getQueryData",
  "getQueryState",
] as const

/** Calls whose key is a filter over entries (prefix match by default). */
export const TARGET_CALLS = [
  "invalidateQueries",
  "refetchQueries",
  "removeQueries",
  "resetQueries",
  "cancelQueries",
  "setQueriesData",
  "getQueriesData",
  "isFetching",
] as const

export type KeyUse = "entry" | "target" | "unknown"

const CALL = new RegExp(`\\b(${[...ENTRY_CALLS, ...TARGET_CALLS].join("|")})\\s*(?:<[^>]*>)?\\s*\\(`, "g")
const ENTRY = new Set<string>(ENTRY_CALLS)

/** How the key at `index` in `source` is used: by the nearest enclosing TanStack call within `window` chars. */
export function keyUseAt(source: string, index: number, window = 400): KeyUse {
  const before = source.slice(Math.max(0, index - window), index)
  const calls = [...before.matchAll(CALL)]
  const last = calls[calls.length - 1]
  if (!last) return "unknown"
  return ENTRY.has(last[1] ?? "") ? "entry" : "target"
}

/** Source without comments (a key named in prose is not a use); `://` in strings is kept. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
}

/** Every index at which any of `expressions` (literal text) occurs in `source`. */
export function occurrences(source: string, expressions: readonly string[]): readonly { readonly expression: string; readonly index: number }[] {
  return expressions.flatMap((expression) => {
    const found: { expression: string; index: number }[] = []
    for (let at = source.indexOf(expression); at !== -1; at = source.indexOf(expression, at + 1)) found.push({ expression, index: at })
    return found
  })
}

/** The source spellings of a literal key: `["credits"]`, `['credits']`, with any spacing. */
export function literalSpellings(key: readonly string[]): readonly RegExp[] {
  const body = key.map((part) => `\\s*["']${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*`).join(",")
  return [new RegExp(`\\[${body}\\]`, "g")]
}

/** Paths into a key factory object whose value (or zero-/one-arg result) equals `key` exactly. */
export function factoryPathsEqualTo(factory: Record<string, unknown>, key: readonly string[], prefix = "queryKeys"): readonly string[] {
  const same = (value: unknown) => Array.isArray(value) && value.length === key.length && value.every((part, i) => part === key[i])
  return Object.entries(factory).flatMap(([name, value]) => {
    const path = `${prefix}.${name}`
    if (same(value)) return [path]
    if (typeof value === "function") {
      try {
        return same((value as (...args: string[]) => unknown)("x")) ? [`${path}(`] : []
      } catch {
        return []
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) return factoryPathsEqualTo(value as Record<string, unknown>, key, path)
    return []
  })
}

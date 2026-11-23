/**
 * `asset_favorites` and `catalog_favorites` (migration 688) until they reach
 * the database.
 *
 * Staging runs dev against the SHARED production database, and migrations
 * apply only at the dev→main promotion — so for that window the tables do not
 * exist, and a read that names them fails the whole statement. Every site that
 * names them asks here first, and the default is the SAFE one: the tables are
 * treated as absent until a probe (`watchFavoritesTables`, at boot and every
 * few minutes) has seen them — so a process that never probes simply never
 * names them. Absent means: a library read reports an upload as not favorited
 * (nothing can be starred yet) and its `favorited` filter — which reads the
 * same migration's functions — answers 503 not_available, the combined
 * favorites read leaves the two kinds out, and a write answers 503
 * not_available.
 *
 * The precedent is lib/jobs-title-column.ts (the same probe for a column).
 */
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"

/** The two tables migration 688 creates; both arrive together, both are probed. */
export const FAVORITES_TABLES = ["asset_favorites", "catalog_favorites"] as const

/** How often a process that has not seen the tables asks again (the promotion applies them without a restart of staging). */
export const FAVORITES_TABLES_REPROBE_MS = 5 * 60 * 1000

let present = false
let watcher: ReturnType<typeof setInterval> | null = null

/** Are both tables known, in this process, to exist? False until a probe has seen them. */
export function favoritesTablesPresent(): boolean {
  return present
}

/** True when `error` says a table does not exist — the tables are then forgotten until the next probe sees them. */
export function noteFavoritesTableError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!isMissingTableError(error)) return false
  present = false
  return true
}

/**
 * One cheap read per table. Present when both answer; absent on a
 * missing-table error; unchanged on any other failure (the database being
 * unreachable says nothing about its tables). Never throws.
 */
export async function probeFavoritesTables(): Promise<boolean> {
  try {
    const answers = await Promise.all(
      // A schema probe — do the tables exist — not a read of anyone's favorites.
      FAVORITES_TABLES.map((table) => supabase.from(table).select("id").limit(1)),
    )
    if (answers.some((a) => isMissingTableError(a.error))) present = false
    else if (answers.every((a) => !a.error)) present = true
  } catch {
    // Unreachable database: keep what we know.
  }
  return present
}

/**
 * Boot: probe now, then every FAVORITES_TABLES_REPROBE_MS until the tables are
 * seen (after that, only an error forgets them and starts the asking again).
 * The timer never keeps the process alive. Idempotent.
 */
export function watchFavoritesTables(): void {
  void probeFavoritesTables()
  if (watcher) return
  watcher = setInterval(() => {
    if (!present) void probeFavoritesTables()
  }, FAVORITES_TABLES_REPROBE_MS)
  watcher.unref?.()
}

/** For tests: set what the process believes, and stop the watcher. */
export function setFavoritesTablesPresentForTests(value: boolean): void {
  present = value
  if (watcher) {
    clearInterval(watcher)
    watcher = null
  }
}

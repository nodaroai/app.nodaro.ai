/**
 * `workflow_view_links` (migration 691) until it reaches the database.
 *
 * Staging runs dev against the SHARED production database, and migrations
 * apply only at the dev→main promotion — so for that window the table does
 * not exist. Every route asks here first, and the default is the SAFE one:
 * the table is treated as absent until a probe (`watchViewLinksTable`, at
 * boot and every few minutes) has seen it. Absent means every view-link route
 * answers 503 not_available, and a workflow's view page says the feature is
 * not available yet.
 *
 * The precedent is lib/favorites-tables.ts.
 */
import { supabase } from "../supabase.js"
import { isMissingTableError } from "../postgrest-errors.js"

export const VIEW_LINKS_TABLE = "workflow_view_links"

/** How often a process that has not seen the table asks again (the promotion applies it without a restart of staging). */
export const VIEW_LINKS_TABLE_REPROBE_MS = 5 * 60 * 1000

let present = false
let watcher: ReturnType<typeof setInterval> | null = null

/** Is the table known, in this process, to exist? False until a probe has seen it. */
export function viewLinksTablePresent(): boolean {
  return present
}

/** True when `error` says the table does not exist — it is then forgotten until the next probe sees it. */
export function noteViewLinksTableError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!isMissingTableError(error)) return false
  present = false
  return true
}

/** One cheap read. Present when it answers; absent on a missing-table error; unchanged otherwise. Never throws. */
export async function probeViewLinksTable(): Promise<boolean> {
  try {
    // A schema probe — does the table exist — not a read of anyone's link.
    const { error } = await supabase.from(VIEW_LINKS_TABLE).select("workflow_id").limit(1)
    if (isMissingTableError(error)) present = false
    else if (!error) present = true
  } catch {
    // Unreachable database: keep what we know.
  }
  return present
}

/** Boot: probe now, then until the table is seen. Idempotent; the timer never keeps the process alive. */
export function watchViewLinksTable(): void {
  void probeViewLinksTable()
  if (watcher) return
  watcher = setInterval(() => {
    if (!present) void probeViewLinksTable()
  }, VIEW_LINKS_TABLE_REPROBE_MS)
  watcher.unref?.()
}

/** For tests: set what the process believes, and stop the watcher. */
export function setViewLinksTablePresentForTests(value: boolean): void {
  present = value
  if (watcher) {
    clearInterval(watcher)
    watcher = null
  }
}

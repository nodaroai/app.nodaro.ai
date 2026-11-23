/**
 * A `jobs` column that may not be in the database yet.
 *
 * Staging runs dev against the SHARED production database, and migrations
 * apply only at the dev→main promotion — so for that window a new column does
 * not exist, and a read or write that names it fails the WHOLE statement: a
 * job list, a session's feed, the gallery, the library and a webhook's job
 * read would all answer errors. Every site that names such a column goes
 * through one of these, and the default is the SAFE one: the column is
 * treated as absent until a probe (`watch`, at boot and every few minutes)
 * has seen it — so a process that never probes simply never names it.
 *
 * Used for `jobs.title` (migration 609, lib/jobs-title-column.ts),
 * `jobs.cover_url` (migration 686, lib/jobs-cover-column.ts) and
 * `share_links.locale` (migration 689, lib/share-links/locale-column.ts).
 *
 * A missing-column error is matched to ITS column (review round, decided
 * 2026-11-23): Postgres names the column in the message (`column
 * jobs.title does not exist`, or `jobs_1.title` through an embed) and
 * PostgREST quotes it (`Could not find the 'cover_url' column of 'jobs'`), so
 * one column's absence never makes the process forget another that exists.
 * An error that names no column at all cannot be told apart: every column
 * asked about is then forgotten until its next probe (the safe side).
 */
import { supabase } from "./supabase.js"

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
export const MISSING_COLUMN_CODES: ReadonlySet<string> = new Set(["42703", "PGRST204"])

/** How often a process that has not seen a column asks again (the promotion applies it without a restart of staging). */
export const OPTIONAL_COLUMN_REPROBE_MS = 5 * 60 * 1000

/** What a database error looks like here. */
export interface ColumnError {
  readonly code?: string | null
  readonly message?: string | null
}

export interface OptionalJobsColumn {
  /** The column's name. */
  readonly column: string
  /** Is the column known, in this process, to exist? False until a probe has seen it. */
  present(): boolean
  /** True when `error` says THIS column does not exist — it is then forgotten until the next probe sees it. */
  noteError(error: ColumnError | null | undefined): boolean
  /** One cheap read that names the column. Never throws. */
  probe(): Promise<boolean>
  /** Boot: probe now, then until the column is seen. Idempotent; the timer never keeps the process alive. */
  watch(): void
  /** For tests: set what the process believes, and stop the watcher. */
  setPresentForTests(value: boolean): void
}

/** Every optional `jobs` column this process knows, for `noteMissingJobsColumns` (another table's are not jobs reads' concern). */
const REGISTERED: OptionalJobsColumn[] = []

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Whether a missing-column error is about `column` (an error naming no column is about every one). */
export function missingColumnErrorNames(error: ColumnError | null | undefined, column: string): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  const message = error.message ?? ""
  if (message.trim() === "") return true
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(column)}([^A-Za-z0-9_]|$)`).test(message)
}

export function optionalJobsColumn(column: string): OptionalJobsColumn {
  return optionalTableColumn("jobs", column)
}

/**
 * The same gate for a column of another service-role table (e.g.
 * `share_links.locale`, migration 689, lib/share-links/locale-column.ts).
 */
export function optionalTableColumn(table: string, column: string): OptionalJobsColumn {
  let present = false
  let watcher: ReturnType<typeof setInterval> | null = null

  const probe = async (): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from(table)
        // trash-read: a schema probe — does the column exist — not a read of any job.
        .select(column)
        .limit(1)
      if (!error) present = true
      else if (MISSING_COLUMN_CODES.has(error.code ?? "")) present = false
    } catch {
      // Unreachable database: keep what we know.
    }
    return present
  }

  const handle: OptionalJobsColumn = {
    column,
    present: () => present,
    noteError(error) {
      if (!missingColumnErrorNames(error, column)) return false
      present = false
      return true
    },
    probe,
    watch() {
      void probe()
      if (watcher) return
      watcher = setInterval(() => {
        if (!present) void probe()
      }, OPTIONAL_COLUMN_REPROBE_MS)
      watcher.unref?.()
    },
    setPresentForTests(value) {
      present = value
      if (watcher) {
        clearInterval(watcher)
        watcher = null
      }
    },
  }
  if (table === "jobs") REGISTERED.push(handle)
  return handle
}

/**
 * Every optional column `error` says is missing, each noted (forgotten until
 * its next probe). ALL are asked — never a short-circuit — so a statement
 * naming two of them learns about each. Empty when the error is not a
 * missing-column error. A read retries once per name answered here.
 */
export function noteMissingJobsColumns(error: ColumnError | null | undefined): string[] {
  return REGISTERED.filter((c) => c.noteError(error)).map((c) => c.column)
}

/** How many optional columns a read may have to drop, one retry each. */
export function optionalJobsColumnCount(): number {
  return REGISTERED.length
}

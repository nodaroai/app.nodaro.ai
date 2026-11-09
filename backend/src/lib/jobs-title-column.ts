/**
 * `jobs.title` (migration 609, a job's owner-given name) until it reaches the
 * database.
 *
 * Staging runs dev against the SHARED production database, and migrations
 * apply only at the dev→main promotion — so for that window the column does
 * not exist, and a read or write that names it fails the WHOLE statement: a
 * job list, a session's feed, the gallery, the library and a webhook's job
 * read would all answer errors. Every site that names the column goes through
 * here, and the default is the SAFE one: the column is treated as absent until
 * a probe (`watchTitleColumn`, at boot and every few minutes) has seen it —
 * so a process that never probes simply never names it. Absent means no name:
 * the reads leave `title` out, and naming a job answers "not available yet".
 *
 * The precedent is lib/jobs-slot-wait-column.ts, which learns a column's
 * absence from the first error; this module asks first, because the title
 * sits in the hottest reads of the API and a first-request failure on each
 * instance after every deploy is not acceptable there.
 */
import { supabase } from "./supabase.js"

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

/** How often a process that has not seen the column asks again (the promotion applies it without a restart of staging). */
export const TITLE_COLUMN_REPROBE_MS = 5 * 60 * 1000

let present = false
let watcher: ReturnType<typeof setInterval> | null = null

/** Is `jobs.title` known, in this process, to exist? False until a probe has seen it. */
export function titleColumnPresent(): boolean {
  return present
}

/** What a jobs select appends for the name: `, title`, or nothing until the column exists. */
export function titleSelect(): "" | ", title" {
  return present ? ", title" : ""
}

/** What the library's assets select appends to read the file's job's name, or nothing until the column exists. */
export function titleEmbedSelect(): "" | ", job:jobs!job_id(title)" {
  return present ? ", job:jobs!job_id(title)" : ""
}

/** True when `error` says the column does not exist — the column is then forgotten until the next probe sees it. */
export function noteTitleColumnError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  present = false
  return true
}

/**
 * One cheap read that names the column. Present when it answers; absent on a
 * missing-column error; unchanged on any other failure (the database being
 * unreachable says nothing about its columns). Never throws.
 */
export async function probeTitleColumn(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("jobs")
      // trash-read: a schema probe — does the column exist — not a read of any job.
      .select("title")
      .limit(1)
    if (!error) present = true
    else if (MISSING_COLUMN_CODES.has(error.code ?? "")) present = false
  } catch {
    // Unreachable database: keep what we know.
  }
  return present
}

/**
 * Boot: probe now, then every TITLE_COLUMN_REPROBE_MS until the column is
 * seen (after that, only an error forgets it and starts the asking again).
 * The timer never keeps the process alive. Idempotent.
 */
export function watchTitleColumn(): void {
  void probeTitleColumn()
  if (watcher) return
  watcher = setInterval(() => {
    if (!present) void probeTitleColumn()
  }, TITLE_COLUMN_REPROBE_MS)
  watcher.unref?.()
}

/** For tests: set what the process believes, and stop the watcher. */
export function setTitleColumnPresentForTests(value: boolean): void {
  present = value
  if (watcher) {
    clearInterval(watcher)
    watcher = null
  }
}

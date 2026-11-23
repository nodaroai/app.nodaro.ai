/**
 * `jobs.title` (migration 609, a job's owner-given name) until it reaches the
 * database: one of the optional `jobs` columns (lib/jobs-optional-column.ts),
 * which says why a column is treated as absent until a probe has seen it.
 * Absent means no name: the reads leave `title` out, and naming a job answers
 * "not available yet".
 *
 * The precedent is lib/jobs-slot-wait-column.ts, which learns a column's
 * absence from the first error; this module asks first, because the title
 * sits in the hottest reads of the API and a first-request failure on each
 * instance after every deploy is not acceptable there.
 */
import { OPTIONAL_COLUMN_REPROBE_MS, optionalJobsColumn, type ColumnError } from "./jobs-optional-column.js"

const column = optionalJobsColumn("title")

/** How often a process that has not seen the column asks again (the promotion applies it without a restart of staging). */
export const TITLE_COLUMN_REPROBE_MS = OPTIONAL_COLUMN_REPROBE_MS

/** Is `jobs.title` known, in this process, to exist? False until a probe has seen it. */
export function titleColumnPresent(): boolean {
  return column.present()
}

/** What a jobs select appends for the name: `, title`, or nothing until the column exists. */
export function titleSelect(): "" | ", title" {
  return column.present() ? ", title" : ""
}

/** What the library's assets select appends to read the file's job's name, or nothing until the column exists. */
export function titleEmbedSelect(): "" | ", job:jobs!job_id(title)" {
  return column.present() ? ", job:jobs!job_id(title)" : ""
}

/** True when `error` says the title column does not exist — it is then forgotten until the next probe sees it. */
export function noteTitleColumnError(error: ColumnError | null | undefined): boolean {
  return column.noteError(error)
}

/**
 * One cheap read that names the column. Present when it answers; absent on a
 * missing-column error; unchanged on any other failure (the database being
 * unreachable says nothing about its columns). Never throws.
 */
export function probeTitleColumn(): Promise<boolean> {
  return column.probe()
}

/**
 * Boot: probe now, then every TITLE_COLUMN_REPROBE_MS until the column is
 * seen (after that, only an error forgets it and starts the asking again).
 * The timer never keeps the process alive. Idempotent.
 */
export function watchTitleColumn(): void {
  column.watch()
}

/** For tests: set what the process believes, and stop the watcher. */
export function setTitleColumnPresentForTests(value: boolean): void {
  column.setPresentForTests(value)
}

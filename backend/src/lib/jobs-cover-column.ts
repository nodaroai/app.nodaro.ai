/**
 * `jobs.cover_url` (migration 686, a job's owner-chosen cover picture) until
 * it reaches the database: the same safe default as the title's
 * (lib/jobs-optional-column.ts). Absent means no custom cover: the reads leave
 * it out (a job's `coverUrl` is then the provider's art, or null), and setting
 * a cover answers "not available yet".
 */
import { optionalJobsColumn } from "./jobs-optional-column.js"

const column = optionalJobsColumn("cover_url")

export const coverColumnPresent = (): boolean => column.present()
export const noteCoverColumnError = column.noteError
export const probeCoverColumn = (): Promise<boolean> => column.probe()
export const watchCoverColumn = (): void => column.watch()
export const setCoverColumnPresentForTests = (value: boolean): void => column.setPresentForTests(value)

/** What a jobs select appends for the custom cover: `, cover_url`, or nothing until the column exists. */
export function coverSelect(): "" | ", cover_url" {
  return column.present() ? ", cover_url" : ""
}

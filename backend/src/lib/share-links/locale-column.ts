/**
 * `share_links.locale` (migration 689, the language a link was shared in) until
 * it reaches the database: staging runs against the shared database before the
 * promotion applies it, so every read and write names the column only once a
 * probe has seen it (lib/jobs-optional-column.ts). Absent, a link has no
 * language: its card reads in English and a sent language is not kept.
 */
import { optionalTableColumn } from "../jobs-optional-column.js"

const column = optionalTableColumn("share_links", "locale")

export const shareLocaleColumnPresent = (): boolean => column.present()
export const noteShareLocaleColumnError = column.noteError
export const watchShareLocaleColumn = (): void => column.watch()
export const setShareLocaleColumnPresentForTests = (value: boolean): void => column.setPresentForTests(value)

/** What a share_links select appends: `, locale`, or nothing until the column exists. */
export function localeSelect(): "" | ", locale" {
  return column.present() ? ", locale" : ""
}

/**
 * Trend tag labels (migration 555): a translated label for each tag of the
 * catalog.
 *
 * A trend's tags stay plain strings on `trends.tags` — what the catalog
 * filters on. `trend_tags` keys a tag's labels (`{ locale: label }`) by that
 * exact string; a tag with no row, or no label in the asked language nor in
 * English, reads as the tag itself (`tagLabel`).
 */
import { LANGUAGES } from "@nodaro/shared/i18n"
import { supabase } from "../../../lib/supabase.js"
import { isMissingTableError } from "../../../lib/postgrest-errors.js"
import { TrendsUnavailableError } from "./store.js"
import type { Locale } from "./types.js"

/** A tag's labels by platform language. Every one optional; none means the tag reads as itself. */
export type TagLabels = Partial<Record<Locale, string>>

const LOCALES: ReadonlySet<string> = new Set(LANGUAGES.map((l) => l.id))

function fail(what: string, error: { code?: string | null; message?: string }): never {
  if (isMissingTableError(error)) throw new TrendsUnavailableError()
  throw new Error(`Could not ${what}: ${error.message ?? "unknown error"}`)
}

/** Only non-empty string labels of platform languages, trimmed. */
function cleanLabels(raw: unknown): TagLabels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: TagLabels = {}
  for (const [locale, label] of Object.entries(raw)) {
    if (!LOCALES.has(locale) || typeof label !== "string") continue
    const text = label.trim()
    if (text) out[locale as Locale] = text
  }
  return out
}

/** The label of `tag` in `locale`, else English, else the tag itself. */
export function tagLabel(tag: string, labels: TagLabels | undefined, locale: string): string {
  const own = labels && Object.hasOwn(labels, locale) ? labels[locale as Locale] : undefined
  return own || labels?.en || tag
}

function byCountThenTag(a: { tag: string; count: number }, b: { tag: string; count: number }): number {
  return b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
}

/** The tags in use on PUBLISHED trends, with how many carry each: most used first, then by tag. */
export async function publishedTagUsage(): Promise<Array<{ tag: string; count: number }>> {
  const { data, error } = await supabase.from("trends").select("tags").eq("status", "published")
  if (error) fail("read the trend tags", error)
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ tags: string[] | null }>) {
    for (const tag of new Set(row.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort(byCountThenTag)
}

/** Every trend's tags (any status): how many trends carry each, and how many of them are published. */
export async function allTagUsage(): Promise<Map<string, { trends: number; published: number }>> {
  const { data, error } = await supabase.from("trends").select("status, tags")
  if (error) fail("read the trend tags", error)
  const out = new Map<string, { trends: number; published: number }>()
  for (const row of (data ?? []) as Array<{ status: string; tags: string[] | null }>) {
    for (const tag of new Set(row.tags ?? [])) {
      const seen = out.get(tag) ?? { trends: 0, published: 0 }
      out.set(tag, { trends: seen.trends + 1, published: seen.published + (row.status === "published" ? 1 : 0) })
    }
  }
  return out
}

/**
 * The labels of `tags` (every labelled tag without a list), by tag.
 *
 * The table is small (one row per labelled tag), so it is read whole and
 * matched here: a tag is any string an admin typed, and it never goes into
 * the query (a PostgREST `in` list would have to quote it).
 */
export async function readTagLabels(tags?: string[]): Promise<Map<string, TagLabels>> {
  const out = new Map<string, TagLabels>()
  if (tags && tags.length === 0) return out
  const wanted = tags ? new Set(tags) : null
  const { data, error } = await supabase.from("trend_tags").select("tag, labels")
  if (error) fail("read the trend tag labels", error)
  for (const row of (data ?? []) as Array<{ tag: string; labels: unknown }>) {
    if (!wanted || wanted.has(row.tag)) out.set(row.tag, cleanLabels(row.labels))
  }
  return out
}

/**
 * Save `tag`'s labels (only non-empty ones of platform languages, trimmed);
 * none left removes the tag's row, so it reads as itself again. Returns what
 * was saved.
 */
export async function saveTagLabels(tag: string, labels: TagLabels): Promise<TagLabels> {
  const clean = cleanLabels(labels)
  if (Object.keys(clean).length === 0) {
    const { error } = await supabase.from("trend_tags").delete().eq("tag", tag)
    if (error) fail(`clear the labels of tag ${tag}`, error)
    return {}
  }
  const { error } = await supabase
    .from("trend_tags")
    .upsert({ tag, labels: clean, updated_at: new Date().toISOString() }, { onConflict: "tag" })
  if (error) fail(`save the labels of tag ${tag}`, error)
  return clean
}

/**
 * Which job-cover copies a job still shows (decided 2026-11-23, review
 * round). A leaf on purpose — the database client, the column gate and the
 * key shape — so the key-ownership judgment (lib/key-ownership.ts), which
 * every storage deleter asks, can ask it without a cycle.
 *
 * A cover copy (`job-covers/<userId>/…`) is the job's own file: the job names
 * it in `jobs.cover_url`, and nothing else records it. So a deleter that
 * finds the key some other way — a library row the user saved from the
 * cover's address, a retention reaper, the failed-delete retry — keeps it
 * while any job names it. The job's own release (lib/job-cover/cover-store.ts)
 * runs only after the job stopped naming it.
 */
import { config } from "../config.js"
import { supabase } from "../supabase.js"
import { coverColumnPresent, noteCoverColumnError, probeCoverColumn } from "../jobs-cover-column.js"
import { isJobCoverKey } from "./cover-key.js"

type LookupClient = Pick<typeof supabase, "from">

const LOOKUP_CHUNK = 100

/** The address a cover key is stored under in `jobs.cover_url` (lib/storage.ts `r2Url`). */
export function coverUrlOfKey(key: string): string {
  return `${config.R2_PUBLIC_URL}/${key}`
}

/**
 * The cover keys among `keys` that some job — any user's, in the Trash or
 * not — still names as its cover. Keys that are not cover keys are never
 * asked about (and never returned). A database without the column has no job
 * naming anything. THROWS when the lookup fails: a caller that cannot ask
 * must keep the object.
 */
export async function coverKeysNamedByJobs(keys: readonly string[], client: LookupClient = supabase): Promise<Set<string>> {
  const covers = [...new Set(keys.filter((k) => !!k && isJobCoverKey(k)))]
  const named = new Set<string>()
  if (covers.length === 0) return named
  // A process that has not seen the column yet (its boot, or after an error
  // forgot it) asks the database before answering "no job names it": a
  // deleter must never read "not seen yet" as "not there".
  if (!coverColumnPresent() && !(await probeCoverColumn())) return named
  const keyOfUrl = new Map(covers.map((k) => [coverUrlOfKey(k), k]))
  const urls = [...keyOfUrl.keys()]
  for (let i = 0; i < urls.length; i += LOOKUP_CHUNK) {
    const chunk = urls.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client
      .from("jobs")
      // trash-read: a job in the Trash still shows its cover when restored, so its copy is kept.
      .select("cover_url")
      .in("cover_url", chunk)
    if (error) {
      // The column left this database: no job can name a cover.
      if (noteCoverColumnError(error)) return named
      throw new Error(`job cover reference lookup failed: ${error.message}`)
    }
    for (const row of (data ?? []) as Array<{ cover_url: string | null }>) {
      const key = row.cover_url ? keyOfUrl.get(row.cover_url) : undefined
      if (key) named.add(key)
    }
  }
  return named
}

/**
 * The owner's own changes to a job (`PATCH /v1/jobs/:id`): its name
 * (`title`, migration 609, lib/job-title.ts) and its cover picture
 * (`cover_url`, migration 686, lib/job-cover/). Each optional, written in one
 * statement, scoped to the owner: a row that is not theirs is not updated,
 * and answers as missing. A field whose column is not in the database yet
 * answers "not available" and nothing is written.
 *
 * A cover change is a COMPARE-AND-SET on the cover the change read (review
 * round, decided 2026-11-23): two changes racing on one job cannot both
 * write, so the copy one of them made is never left behind unnamed. The one
 * that loses answers `conflict` (409), having released its own copy; the
 * caller reads the job again and decides.
 */
import { supabase } from "./supabase.js"
import { CHILD_JOB_COLUMN } from "./public-job-data.js"
import { titleColumnPresent } from "./jobs-title-column.js"
import { coverColumnPresent } from "./jobs-cover-column.js"
import { noteMissingJobsColumns } from "./jobs-optional-column.js"
import { resolveJobCoverSource, type JobCoverProblem, type JobCoverRequest } from "./job-cover/cover-source.js"
import { releaseJobCovers, storeJobCover } from "./job-cover/cover-store.js"
import { effectiveJobCover } from "./job-cover/effective-cover.js"
import { takeCoverWrite } from "./job-cover/cover-rate-limit.js"

export interface JobOwnerChanges {
  /** Normalized already (`normalizeJobTitle`): a name, or null to clear it. Absent = unchanged. */
  readonly title?: string | null
  /** A picture of the caller's, or null to clear it. Absent = unchanged. */
  readonly cover?: JobCoverRequest | null
}

export type UpdateJobOutcome =
  | { kind: "ok"; title?: string | null; coverUrl?: string | null }
  /** Not the caller's job, a child job, or no such job — the same answer, never a hint which. */
  | { kind: "not_found" }
  /** A column the change names is not in this database yet. */
  | { kind: "not_available"; field: "title" | "cover" }
  | { kind: "invalid_cover"; problem: JobCoverProblem }
  /** Another change to this job's cover landed first: nothing was written. */
  | { kind: "conflict" }
  /** The caller sent more cover changes this minute than the cover's own limit allows. */
  | { kind: "rate_limited"; retryAfterSec: number }

interface OwnedRow {
  readonly cover_url?: string | null
  readonly output_data?: unknown
}

type UpdatedRow = { title?: string | null; cover_url?: string | null; output_data?: unknown }

/** The owner's row, before the change (the cover it may replace, the art it falls back to). */
async function ownedRow(ownerId: string, jobId: string, withCover: boolean): Promise<OwnedRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    // trash-read: a job in the Trash is renamed and re-covered too (it comes back from the Trash with them).
    .select(withCover ? "id, output_data, cover_url" : "id, output_data")
    .eq("id", jobId)
    .eq("user_id", ownerId)
    // A child job is shown only through its parent; it is not changed on its own.
    .is(CHILD_JOB_COLUMN, null)
    .maybeSingle()
  if (error) throw error
  return (data as OwnedRow | null) ?? null
}

/** The cover address the change writes: a fresh copy, null to clear, undefined when the cover is not changed. */
async function coverToWrite(ownerId: string, cover: JobCoverRequest | null | undefined): Promise<{ url: string | null | undefined } | { problem: JobCoverProblem }> {
  if (cover === undefined) return { url: undefined }
  if (cover === null) return { url: null }
  const source = await resolveJobCoverSource(ownerId, cover)
  if (!source.ok) return { problem: source.problem }
  return { url: await storeJobCover(ownerId, source.sourceKey, source.ext) }
}

/** The one owner-scoped write; with a cover, only while the row still has the cover `before` read. */
async function writeChanges(ownerId: string, jobId: string, patch: Record<string, unknown>, opts: { wantsTitle: boolean; wantsCover: boolean; before: OwnedRow }) {
  const select = ["id", "output_data", ...(opts.wantsTitle ? ["title"] : []), ...(opts.wantsCover ? ["cover_url"] : [])].join(", ")
  const base = supabase.from("jobs").update(patch).eq("id", jobId).eq("user_id", ownerId).is(CHILD_JOB_COLUMN, null)
  const previous = opts.before.cover_url ?? null
  const guarded = !opts.wantsCover ? base : previous === null ? base.is("cover_url", null) : base.eq("cover_url", previous)
  return guarded.select(select).maybeSingle()
}

/** Which field a missing-column error was about (the cover when it names both, or none). */
function missingField(error: unknown, wantsCover: boolean): "title" | "cover" | null {
  const missing = noteMissingJobsColumns(error as { code?: string; message?: string } | null)
  if (wantsCover && missing.includes("cover_url")) return "cover"
  if (missing.includes("title")) return "title"
  return null
}

/**
 * Apply the owner's changes. `jobId` is a well-formed uuid. Throws on a
 * database or storage failure (a copy made for the change is released first).
 */
export async function updateJobOwnerFields(ownerId: string, jobId: string, changes: JobOwnerChanges): Promise<UpdateJobOutcome> {
  const wantsTitle = changes.title !== undefined
  const wantsCover = changes.cover !== undefined
  if (wantsTitle && !titleColumnPresent()) return { kind: "not_available", field: "title" }
  if (wantsCover && !coverColumnPresent()) return { kind: "not_available", field: "cover" }
  // The cover's own limit, before anything is read (lib/job-cover/cover-rate-limit.ts).
  if (wantsCover) {
    const verdict = takeCoverWrite(ownerId)
    if (!verdict.allowed) return { kind: "rate_limited", retryAfterSec: verdict.retryAfterSec }
  }

  // Ownership first: another user's job is never judged, copied or written.
  const before = await ownedRow(ownerId, jobId, wantsCover)
  if (!before) return { kind: "not_found" }

  const cover = await coverToWrite(ownerId, changes.cover)
  if ("problem" in cover) return { kind: "invalid_cover", problem: cover.problem }
  const coverUrl = cover.url

  const patch = { ...(wantsTitle ? { title: changes.title } : {}), ...(coverUrl !== undefined ? { cover_url: coverUrl } : {}) }
  const { data, error } = await writeChanges(ownerId, jobId, patch, { wantsTitle, wantsCover, before })
  if (error || !data) {
    // The copy this change made names nothing now (released only when nothing does).
    if (coverUrl) await releaseJobCovers(ownerId, [coverUrl])
    const field = error ? missingField(error, wantsCover) : null
    if (field) return { kind: "not_available", field }
    if (error) throw error
    // No row matched: the job is gone (or never was theirs), or its cover changed under us.
    if (!wantsCover || !(await ownedRow(ownerId, jobId, false))) return { kind: "not_found" }
    return { kind: "conflict" }
  }
  const row = data as UpdatedRow
  // The cover it replaced, when nothing names it any more.
  if (wantsCover && before.cover_url && before.cover_url !== row.cover_url) await releaseJobCovers(ownerId, [before.cover_url])
  return {
    kind: "ok",
    ...(wantsTitle ? { title: row.title ?? null } : {}),
    ...(wantsCover ? { coverUrl: effectiveJobCover(row) } : {}),
  }
}

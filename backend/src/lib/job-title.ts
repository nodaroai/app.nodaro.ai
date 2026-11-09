/**
 * A name of the person's own on a job (migration 609): "Wedding toast, final"
 * on a picture, a clip, a track or a speech take, instead of the name a client
 * makes up for it. Set and cleared by the job's owner only
 * (`PATCH /v1/jobs/:id`, routes/job-title.ts); read back wherever a job is
 * returned, as `title` on `PUBLIC_JOB_KEYS` — `GET /v1/jobs/:id` and the list,
 * a session's items, the Trash, the gallery's cards and the library's rows
 * (through the file's job). `null` until named.
 *
 * The rule is the table's (the 609 CHECK) and the route's alike: plain text,
 * trimmed, 1–120 characters. Any job type and status; a job in the Trash is
 * renamed too (it comes back from the Trash under its name). A job the owner
 * cannot see — someone else's, or a child job hidden from every read — is
 * "no such job", never a hint which.
 */
import { supabase } from "./supabase.js"
import { CHILD_JOB_COLUMN } from "./public-job-data.js"
import { noteTitleColumnError, titleColumnPresent } from "./jobs-title-column.js"

export const JOB_TITLE_MAX_CHARS = 120

/** A control character (a line break, a tab, …) — a title is one line of plain text. */
const CONTROL_CHARACTER = /\p{Cc}/u

export type JobTitleProblem = "too_long" | "not_plain_text"

/**
 * What a client sent, as the job will carry it: trimmed, and an empty or
 * blank string is "no name" (`null`) — so clearing is `null` or `""` alike.
 * Returns the problem instead when the trimmed text is longer than
 * `JOB_TITLE_MAX_CHARS` or is not one line of plain text.
 */
export function normalizeJobTitle(raw: string | null): { title: string | null } | { problem: JobTitleProblem } {
  if (raw === null) return { title: null }
  const trimmed = raw.trim()
  if (trimmed === "") return { title: null }
  if (trimmed.length > JOB_TITLE_MAX_CHARS) return { problem: "too_long" }
  if (CONTROL_CHARACTER.test(trimmed)) return { problem: "not_plain_text" }
  return { title: trimmed }
}

export type SetJobTitleOutcome =
  | { kind: "ok"; title: string | null }
  /** Not the caller's job, a child job, or no such job — the same answer, never a hint which. */
  | { kind: "not_found" }
  /** The column is not in this database yet (staging before migration 609 reaches main). */
  | { kind: "not_available" }

/**
 * Name the owner's own job, or clear its name with `null`. `title` is already
 * normalized (`normalizeJobTitle`); `jobId` is a well-formed uuid. One write,
 * scoped to the owner: a row that is not theirs is not updated, and answers
 * as missing. Throws on a database failure.
 */
export async function setJobTitle(ownerId: string, jobId: string, title: string | null): Promise<SetJobTitleOutcome> {
  if (!titleColumnPresent()) return { kind: "not_available" }
  const { data, error } = await supabase
    .from("jobs")
    .update({ title })
    .eq("id", jobId)
    .eq("user_id", ownerId)
    // A child job is shown only through its parent; it is not named on its own.
    .is(CHILD_JOB_COLUMN, null)
    .select("id, title")
    .maybeSingle()
  if (noteTitleColumnError(error)) return { kind: "not_available" }
  if (error) throw error
  if (!data) return { kind: "not_found" }
  return { kind: "ok", title: (data as { title?: string | null }).title ?? null }
}

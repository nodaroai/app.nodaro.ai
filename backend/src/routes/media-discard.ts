// @reads-none reads no files: only the requester's own assets row and job references in the database
import { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { r2KeyFromOurUrl } from "../lib/storage.js"
import { jobOutputReferrerPaths } from "../lib/job-output-urls.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { deleteSourceAfterProcess } from "./media-process.js"

/**
 * POST /v1/media/discard — a client's way to throw away a file IT JUST MADE
 * and no longer needs: a link download replaced before use, a cut superseded
 * by a newer cut, a picture imported then cancelled. Never a general delete
 * (that is DELETE /v1/library/:id, which the SDK does not expose).
 *
 * The file goes only when every gate holds:
 *   1. the requester's own assets row names the URL's key;
 *   2. it was made by one of DISCARDABLE_SOURCES (never a manual upload);
 *   3. it is younger than DISCARD_WINDOW_MS;
 *   4. no job of the requester references it, as an output
 *      (jobOutputReferrerPaths) or an input (JOB_INPUT_URL_PATHS: a run in
 *      flight would lose its clip).
 * A failed gate, or a lookup that fails, answers 409 not_discardable and
 * touches nothing. No row (already gone, a foreign URL, someone else's file)
 * answers discarded: false, revealing nothing. The delete itself is
 * media-process's own cleanup (ownership verdict, other referrers, quota
 * refund), never a copy of it.
 */

export const DISCARD_WINDOW_MS = 24 * 60 * 60 * 1000

/** `upload_source` values of the files this route may delete. */
export const DISCARDABLE_SOURCES: readonly string[] = ["social_download", "media_process", "url_import"]

/** Job input fields that carry a media URL a run reads. */
export const JOB_INPUT_URL_PATHS = ["input_data->>videoUrl", "input_data->>sourceUrl"] as const

const DiscardSchema = z.object({ url: safeUrlSchema })

function notDiscardable(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(409).send({
    error: { code: "not_discardable", message: "This file can't be discarded" },
  })
}

/** True when a job of the user references the URL, or when that cannot be told. */
async function referencedByAJob(url: string, userId: string): Promise<boolean> {
  for (const path of [...jobOutputReferrerPaths(), ...JOB_INPUT_URL_PATHS]) {
    const { count, error } = await supabase
      // trash-read: a still-referenced check before deleting stored media: a deleted job still holds its media until the purge.
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq(path, url)
    if (error || (count ?? 0) > 0) return true
  }
  return false
}

export async function mediaDiscardRoutes(app: FastifyInstance) {
  app.post("/v1/media/discard", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = DiscardSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues.map((e) => e.message).join(", "),
        },
      })
    }

    const { url } = parsed.data
    const key = r2KeyFromOurUrl(url)
    if (!key) return { data: { discarded: false } }

    const { data: row, error } = await supabase
      .from("assets")
      .select("id, upload_source, created_at")
      .eq("r2_key", key)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()
    if (error) return notDiscardable(reply)
    if (!row) return { data: { discarded: false } }

    const madeAt = row.created_at ? Date.parse(row.created_at) : Number.NaN
    const fresh = Number.isFinite(madeAt) && Date.now() - madeAt < DISCARD_WINDOW_MS
    if (!DISCARDABLE_SOURCES.includes(row.upload_source ?? "") || !fresh) return notDiscardable(reply)
    if (await referencedByAJob(url, userId)) return notDiscardable(reply)

    await deleteSourceAfterProcess(url, userId)
    return { data: { discarded: true } }
  })
}

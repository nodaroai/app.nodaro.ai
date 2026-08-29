import { config } from "./config.js"
import { supabase } from "./supabase.js"

/**
 * Is this URL's OBJECT a QuickTime container? Decided by the path, never by
 * the whole string — KIE result URLs carry signed query strings, and a
 * `?f=.mov` on an mp4 (or an `.mov` before a `?token=…`) must not flip the
 * answer.
 */
export function isMovUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".mov")
  } catch {
    return false
  }
}

/** Our own R2 origin + path prefix — i.e. an object that will still be there. */
function isOurR2Url(url: string): boolean {
  if (!config.R2_PUBLIC_URL) return false
  try {
    const base = new URL(config.R2_PUBLIC_URL)
    const candidate = new URL(url)
    if (candidate.origin !== base.origin) return false
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    return candidate.pathname.startsWith(prefix)
  } catch {
    return false
  }
}

/**
 * Produced-media keys are deterministic (`videos/<jobId>.<ext>`), so a
 * deliverable URL names its own job with no extra lookup table.
 */
const JOB_VIDEO_KEY =
  /^videos\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.[A-Za-z0-9]+$/

function jobIdFromDeliverableUrl(url: string): string | undefined {
  if (!isOurR2Url(url)) return undefined
  try {
    const base = new URL(config.R2_PUBLIC_URL)
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
    const key = new URL(url).pathname.slice(prefix.length)
    return JOB_VIDEO_KEY.exec(key)?.[1]
  } catch {
    return undefined
  }
}

/**
 * The PREVIOUS extension's raw mov, when this extend is continuing a clip we
 * ourselves produced on the 2.5 mov path.
 *
 * Why it matters: the 2 s `@video_1` reference is normally cut out of the
 * stitched deliverable with ffmpeg, which re-encodes it to 4:2:0 — throwing
 * away exactly the colour fidelity `output_format: "mov"` was requested for.
 * If the source IS a job of ours whose raw extension we kept as a `.mov`
 * object, referencing that object directly keeps the whole chain in yuv444p.
 *
 * EVERY failure is silent and falls back to the tail: a foreign source URL, a
 * URL that is not a job-keyed deliverable, a job that is not the caller's, an
 * mp4 raw extension, a KIE temp URL (long expired by the next extend), or a
 * database error. The tail transport is what works today; this only ever
 * upgrades it.
 */
export async function findChainedMovReference(
  sourceUrl: string,
  userId: string | undefined,
): Promise<string | undefined> {
  // No owner ⇒ no ownership-scoped query we are willing to run: fall back.
  if (!userId) return undefined
  const jobId = jobIdFromDeliverableUrl(sourceUrl)
  if (!jobId) return undefined
  try {
    const { data } = await supabase
      .from("jobs")
      .select("output_data")
      .eq("id", jobId)
      // Scoped to the caller: never chain off another user's stored object.
      .eq("user_id", userId)
      .maybeSingle()
    const raw = (data?.output_data as { rawExtensionUrl?: unknown } | null | undefined)?.rawExtensionUrl
    if (typeof raw !== "string") return undefined
    return isMovUrl(raw) && isOurR2Url(raw) ? raw : undefined
  } catch (err) {
    console.warn(`[seedance-extend] chained mov lookup failed for job ${jobId}:`, err)
    return undefined
  }
}

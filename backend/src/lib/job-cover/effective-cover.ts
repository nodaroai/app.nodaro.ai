/**
 * A job's picture, named once: `coverUrl` wherever a job is returned
 * (decided 2026-11-23). The owner's own cover (`jobs.cover_url`, set with
 * `PATCH /v1/jobs/:id { cover }`) when there is one, else the art the
 * provider made with the result (a Suno song's `sunoImageUrl`), else null.
 * Clearing the owner's cover brings the provider's art back.
 *
 * A picture naming restricted bytes is never returned (review round,
 * decided 2026-11-23): a cover copy whose source is under a content
 * restriction, or whose own key is, reads as no cover, and the provider's
 * art the same (lib/job-cover/cover-restriction.ts). Every read that returns
 * a `coverUrl` goes through here, the share reads included.
 */
import { isRestrictedCoverAddress } from "./cover-restriction.js"

/** A web address (a self-hosted install's own storage may be http). */
const webUrl = (v: unknown): string | null =>
  typeof v === "string" && /^https?:\/\//i.test(v) ? v : null

/** A web address that names no restricted bytes. */
const showable = (v: unknown): string | null => {
  const url = webUrl(v)
  return url !== null && !isRestrictedCoverAddress(url) ? url : null
}

/** The art a provider returned with a result, when it did (a Suno song's cover) and it is not restricted. */
export function providerCoverOf(outputData: unknown): string | null {
  if (!outputData || typeof outputData !== "object") return null
  return showable((outputData as Record<string, unknown>).sunoImageUrl)
}

/** The picture to show for a job: the owner's cover, else the provider's art, else null. */
export function effectiveJobCover(row: { readonly cover_url?: unknown; readonly output_data?: unknown }): string | null {
  return showable(row.cover_url) ?? providerCoverOf(row.output_data)
}

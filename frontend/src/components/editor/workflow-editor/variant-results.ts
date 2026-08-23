import { variantJobId } from "@nodaro/shared"
import type { GeneratedResult } from "@/types/nodes"

/**
 * Build N `GeneratedResult` entries from a variant URL array (Grok = up to 6
 * images, Suno = 2 tracks). Variant `jobId`s use `variantJobId(base, i)` so
 * they line up with the worker's R2 keys and stay collision-free with
 * sibling clones.
 *
 * Shared by both the single-node poll path (`poll-job.ts`) and the
 * orchestrator poll path (`run-handlers.ts`) so the two paths produce
 * identical `generatedResults` for the same multi-variant job.
 *
 * `existingUrls` (optional) lets the orchestrator path deduplicate against
 * results that were already added on a prior poll tick.
 *
 * `extraFields` is shared by every variant; `perVariantFields(index, url)` is
 * merged on top per variant (ORIGINAL index + the variant's URL) — the Suno
 * per-track id (#819: one `extraFields` object spread onto both tracks gave
 * track #2 track #1's id, so extending your selected track extended the other
 * one).
 */
export function buildVariantResults(
  urls: readonly string[],
  baseJobId: string,
  opts: {
    readonly thumbnailUrl?: string
    readonly extraFields?: Record<string, unknown>
    readonly perVariantFields?: (index: number, url: string) => Record<string, unknown> | undefined
    readonly existingUrls?: ReadonlySet<string>
  } = {},
): GeneratedResult[] {
  const filtered = opts.existingUrls
    ? urls.filter((u) => !opts.existingUrls!.has(u))
    : urls.slice()
  const timestamp = new Date().toISOString()
  return filtered.map((url, i): GeneratedResult => {
    const originalIndex = urls.indexOf(url)
    const index = originalIndex >= 0 ? originalIndex : i
    return {
      url,
      thumbnailUrl: opts.thumbnailUrl,
      timestamp,
      jobId: variantJobId(baseJobId, index),
      ...(opts.extraFields ?? {}),
      ...(opts.perVariantFields?.(index, url) ?? {}),
    }
  })
}

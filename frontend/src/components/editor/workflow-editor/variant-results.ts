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
 */
export function buildVariantResults(
  urls: readonly string[],
  baseJobId: string,
  opts: {
    readonly thumbnailUrl?: string
    readonly extraFields?: Record<string, unknown>
    readonly existingUrls?: ReadonlySet<string>
  } = {},
): GeneratedResult[] {
  const filtered = opts.existingUrls
    ? urls.filter((u) => !opts.existingUrls!.has(u))
    : urls.slice()
  const timestamp = new Date().toISOString()
  return filtered.map((url, i): GeneratedResult => {
    const originalIndex = urls.indexOf(url)
    return {
      url,
      thumbnailUrl: opts.thumbnailUrl,
      timestamp,
      jobId: variantJobId(baseJobId, originalIndex >= 0 ? originalIndex : i),
      ...(opts.extraFields ?? {}),
    }
  })
}

/**
 * Backfill thumbnails for existing completed video jobs that lack a thumbnailUrl.
 *
 * Usage:
 *   npm run backfill-video-thumbnails
 *   npm run backfill-video-thumbnails -- --dry-run        # preview without changes
 *   npm run backfill-video-thumbnails -- --limit 50       # process at most 50 jobs
 *   npm run backfill-video-thumbnails -- --concurrency 3  # parallel jobs (default 2)
 *   npm run backfill-video-thumbnails -- --regenerate     # re-generate ALL thumbnails (not just missing)
 */

import { supabase } from "../lib/supabase.js"
import { uploadBufferToR2 } from "../lib/storage.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"

const VIDEO_JOB_TYPES = [
  "image-to-video", "text-to-video", "video-to-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "suno-music-video",
  "merge-video-audio", "resize-video", "trim-video", "add-captions",
]

const PAGE_SIZE = 100

function parseArgs() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const regenerate = args.includes("--regenerate")
  const limitIdx = args.indexOf("--limit")
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? "0", 10) || Infinity : Infinity
  const concIdx = args.indexOf("--concurrency")
  const concurrency = concIdx !== -1 ? parseInt(args[concIdx + 1] ?? "2", 10) || 2 : 2
  return { dryRun, regenerate, limit, concurrency }
}

async function fetchJobsBatch(offset: number): Promise<Array<{ id: string; output_data: Record<string, unknown>; user_id: string | null }>> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, output_data, user_id")
    .eq("status", "completed")
    .in("job_type", VIDEO_JOB_TYPES)
    .not("output_data", "is", null)
    .order("completed_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) throw new Error(`DB query failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; output_data: Record<string, unknown>; user_id: string | null }>
}

async function processJob(
  job: { id: string; output_data: Record<string, unknown>; user_id: string | null },
  dryRun: boolean,
  regenerate: boolean,
): Promise<"ok" | "skipped" | "failed"> {
  const videoUrl = job.output_data?.videoUrl as string | undefined
  if (!videoUrl) return "skipped"

  // Already has a thumbnail — skip unless regenerating
  if (job.output_data?.thumbnailUrl && !regenerate) return "skipped"

  if (dryRun) {
    console.log(`  [dry-run] Would generate thumbnail for job ${job.id}`)
    return "ok"
  }

  try {
    const thumbBuffer = await generateThumbnailFromUrl(videoUrl)
    const thumbUrl = await uploadBufferToR2(
      thumbBuffer,
      `thumbnails/${job.id}.jpg`,
      "image/jpeg",
      job.user_id ?? undefined,
    )

    const { error } = await supabase
      .from("jobs")
      .update({
        output_data: { ...job.output_data, thumbnailUrl: thumbUrl },
      })
      .eq("id", job.id)

    if (error) {
      console.error(`  [error] DB update failed for ${job.id}: ${error.message}`)
      return "failed"
    }

    console.log(`  [ok] ${job.id} -> ${thumbUrl}`)
    return "ok"
  } catch (err) {
    console.error(`  [error] ${job.id}: ${err instanceof Error ? err.message : err}`)
    return "failed"
  }
}

async function main() {
  const { dryRun, regenerate, limit, concurrency } = parseArgs()

  console.log(`Backfill video thumbnails`)
  console.log(`  dry-run: ${dryRun}, regenerate: ${regenerate}, limit: ${limit === Infinity ? "none" : limit}, concurrency: ${concurrency}`)
  console.log()

  let offset = 0
  let processed = 0
  let ok = 0
  let skipped = 0
  let failed = 0

  while (processed < limit) {
    const batch = await fetchJobsBatch(offset)
    if (batch.length === 0) break

    // Filter to jobs that need a thumbnail (or all with a videoUrl when regenerating)
    const needsThumbnail = batch.filter((j) => {
      const od = j.output_data
      if (!od?.videoUrl) return false
      return regenerate || !od?.thumbnailUrl
    })

    // Cap to remaining limit
    const toProcess = needsThumbnail.slice(0, limit - processed)

    if (toProcess.length > 0) {
      console.log(`Batch at offset ${offset}: ${toProcess.length} jobs to process (${batch.length - needsThumbnail.length} skipped)`)

      // Process in chunks of `concurrency`
      for (let i = 0; i < toProcess.length; i += concurrency) {
        const chunk = toProcess.slice(i, i + concurrency)
        const results = await Promise.all(chunk.map((j) => processJob(j, dryRun, regenerate)))
        for (const r of results) {
          if (r === "ok") ok++
          else if (r === "skipped") skipped++
          else failed++
        }
        processed += chunk.length
      }
    } else {
      // All in this batch already have thumbnails, keep paging
      skipped += batch.length
    }

    offset += PAGE_SIZE

    // If batch was smaller than page size, we've reached the end
    if (batch.length < PAGE_SIZE) break
  }

  console.log()
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})

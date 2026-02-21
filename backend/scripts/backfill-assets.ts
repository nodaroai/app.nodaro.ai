/**
 * One-time backfill: create asset records for completed jobs missing them.
 * Finds jobs with media URLs in output_data that have no matching asset row.
 *
 * Usage: cd backend && npx tsx scripts/backfill-assets.ts
 */
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? ""

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const MEDIA_FIELDS = [
  { key: "imageUrl", type: "image", mime: "image/png" },
  { key: "videoUrl", type: "video", mime: "video/mp4" },
  { key: "audioUrl", type: "audio", mime: "audio/mpeg" },
] as const

async function backfill() {
  // Step 1: Get all job_ids that already have assets
  console.log("Fetching existing asset job_ids...")
  const { data: existingAssets } = await supabase
    .from("assets")
    .select("job_id, type")
    .not("job_id", "is", null)
    .limit(10000)

  const existingSet = new Set(
    (existingAssets ?? []).map(a => `${a.job_id}:${a.type}`)
  )
  console.log(`  ${existingSet.size} existing job+type combos found`)

  // Step 2: Page through all completed jobs with output_data
  let created = 0
  let skipped = 0
  let errors = 0
  let processed = 0
  const PAGE_SIZE = 500
  let offset = 0

  console.log("Processing completed jobs...")

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, user_id, output_data")
      .eq("status", "completed")
      .not("output_data", "is", null)
      .not("user_id", "is", null)
      .order("completed_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error("Failed to fetch jobs:", error.message)
      break
    }

    if (!jobs || jobs.length === 0) break
    offset += jobs.length

    // Batch: collect all inserts for this page
    const inserts: Array<Record<string, unknown>> = []

    for (const job of jobs) {
      const output = job.output_data as Record<string, unknown>
      const thumbnailUrl = (output.thumbnail_url ?? output.thumbnailUrl ?? null) as string | null

      for (const { key, type, mime } of MEDIA_FIELDS) {
        const url = output[key]
        if (typeof url !== "string" || !url) continue

        if (existingSet.has(`${job.id}:${type}`)) {
          skipped++
          continue
        }

        const r2Key = R2_PUBLIC_URL
          ? url.replace(R2_PUBLIC_URL + "/", "")
          : url

        const filename = url.split("/").pop() ?? `${job.id}.${type === "image" ? "png" : type === "video" ? "mp4" : "mp3"}`

        inserts.push({
          user_id: job.user_id,
          job_id: job.id,
          type,
          r2_key: r2Key,
          r2_url: url,
          filename,
          mime_type: mime,
          size_bytes: 0,
          upload_source: "generated",
          metadata: thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {},
        })

        // Track so we don't double-insert within this run
        existingSet.add(`${job.id}:${type}`)
      }
    }

    // Batch insert (Supabase supports up to 1000 rows per insert)
    if (inserts.length > 0) {
      const { error: insertErr, count } = await supabase
        .from("assets")
        .insert(inserts)

      if (insertErr) {
        console.error(`  Batch insert error:`, insertErr.message)
        errors += inserts.length
      } else {
        created += inserts.length
      }
    }

    processed += jobs.length
    console.log(`  Processed ${processed} jobs (created: ${created}, skipped: ${skipped}, errors: ${errors})`)

    if (jobs.length < PAGE_SIZE) break
  }

  console.log(`\nBackfill complete: ${created} assets created, ${skipped} skipped, ${errors} errors`)
}

backfill().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})

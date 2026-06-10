/**
 * Recover missing R2 media for COMPLETED jobs by re-pulling the result from
 * the provider (KIE recordInfo) and re-uploading to the same deterministic
 * keys recorded in output_data.
 *
 * Built for the 2026-06-10 incident (job 7955772a): a worker/reconcile-cron
 * double-finalize race plus uploadToR2's failure-path delete left a job
 * `completed` + charged while its `images/<jobId>.png` object was deleted.
 * KIE retains task results for a while after completion, so the original
 * output is recoverable without regenerating — but act within days, not weeks.
 *
 * Safe by construction:
 *  - never modifies the jobs row (it is already completed with correct URLs)
 *  - only uploads keys that are MISSING (HeadObject check first); existing
 *    objects are never overwritten
 *  - refuses watermarked jobs (re-uploading the raw provider result would
 *    drop the watermark) — none expected in practice
 *
 * Usage: cd backend && npx tsx scripts/recover-job-media.ts <jobId> [jobId...]
 */
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { HeadObjectCommand } from "@aws-sdk/client-s3"
import { variantJobId } from "@nodaro/shared"
import { s3, uploadToR2, r2KeyFromOurUrl } from "../src/lib/storage.js"
import { config } from "../src/lib/config.js"
import { pollKieTask } from "../src/providers/kie/client.js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

/** provider_kind values whose tasks poll via the standard /jobs/recordInfo. */
const SUPPORTED_KINDS = new Set(["kie-standard", "kie-lip-sync"])

interface JobRow {
  id: string
  status: string
  job_type: string | null
  user_id: string | null
  should_watermark: boolean | null
  provider_kind: string | null
  provider_task_id: string | null
  output_data: Record<string, unknown> | null
}

function mediaUrlsFromOutput(outputData: Record<string, unknown>): string[] {
  // Variant order matters: index i maps to variantJobId(jobId, i), matching
  // how uploadImageVariantsMaybeWatermark keyed the original upload.
  if (typeof outputData.imageUrl === "string") {
    const extras = Array.isArray(outputData.imageUrls)
      ? (outputData.imageUrls as string[]).slice(1)
      : []
    return [outputData.imageUrl, ...extras]
  }
  if (typeof outputData.videoUrl === "string") return [outputData.videoUrl]
  if (typeof outputData.audioUrl === "string") return [outputData.audioUrl]
  return []
}

function mediaTypeFromKey(key: string): "image" | "video" | "audio" | null {
  if (key.startsWith("images/")) return "image"
  if (key.startsWith("videos/")) return "video"
  if (key.startsWith("audios/")) return "audio"
  return null
}

async function keyExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }))
    return true
  } catch {
    return false
  }
}

async function recoverJob(jobId: string): Promise<boolean> {
  console.log(`\n=== ${jobId} ===`)
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, job_type, user_id, should_watermark, provider_kind, provider_task_id, output_data")
    .eq("id", jobId)
    .single()
  if (error || !data) {
    console.error(`  ✗ jobs row not found: ${error?.message ?? "no data"}`)
    return false
  }
  const job = data as JobRow

  if (job.status !== "completed") {
    console.error(`  ✗ status is '${job.status}' — this script only repairs COMPLETED jobs (reconcile owns in-flight ones)`)
    return false
  }
  if (job.should_watermark) {
    console.error("  ✗ job is watermarked — re-uploading the raw provider result would drop the watermark; handle manually")
    return false
  }
  if (!job.provider_task_id) {
    console.error("  ✗ no provider_task_id on the row — nothing to re-poll")
    return false
  }
  if (!SUPPORTED_KINDS.has(job.provider_kind ?? "")) {
    console.error(`  ✗ provider_kind '${job.provider_kind}' not supported (extend SUPPORTED_KINDS if its poll endpoint matches /jobs/recordInfo)`)
    return false
  }

  const urls = mediaUrlsFromOutput(job.output_data ?? {})
  if (urls.length === 0) {
    console.error("  ✗ no media URLs in output_data")
    return false
  }

  // Which recorded keys are actually missing from the bucket?
  const missing: { index: number; key: string; type: "image" | "video" | "audio" }[] = []
  for (const [index, url] of urls.entries()) {
    const key = r2KeyFromOurUrl(url)
    if (!key) {
      console.warn(`  ! [${index}] not an R2 URL, skipping: ${url}`)
      continue
    }
    const type = mediaTypeFromKey(key)
    if (!type) {
      console.warn(`  ! [${index}] unrecognized key prefix, skipping: ${key}`)
      continue
    }
    if (await keyExists(key)) {
      console.log(`  ✓ [${index}] intact: ${key}`)
    } else {
      console.log(`  ✗ [${index}] MISSING: ${key}`)
      missing.push({ index, key, type })
    }
  }
  if (missing.length === 0) {
    console.log("  Nothing to repair.")
    return true
  }

  console.log(`  Re-polling KIE task ${job.provider_task_id}…`)
  const poll = await pollKieTask(job.provider_task_id, 1)
  const resultUrls: string[] =
    poll.resultJson.resultUrls ??
    (poll.resultJson.videoUrl ? [poll.resultJson.videoUrl]
      : poll.resultJson.audioUrl ? [poll.resultJson.audioUrl]
      : [])
  if (resultUrls.length === 0) {
    console.error("  ✗ KIE returned no result URLs (result may have expired) — regeneration is the only option")
    return false
  }

  let repaired = 0
  for (const { index, key, type } of missing) {
    const sourceUrl = resultUrls[index]
    if (!sourceUrl) {
      console.error(`  ✗ [${index}] no matching provider URL (KIE returned ${resultUrls.length})`)
      continue
    }
    // uploadToR2 derives the same deterministic key from (variantJobId, type)
    // that the worker used for the original upload.
    const uploadedUrl = await uploadToR2(sourceUrl, variantJobId(job.id, index), type, job.user_id ?? undefined)
    const verified = await keyExists(key)
    console.log(`  ${verified ? "✓ repaired" : "✗ upload reported ok but HEAD fails"}: ${uploadedUrl}`)
    if (verified) repaired++
  }

  console.log(`  Done: ${repaired}/${missing.length} repaired.`)
  return repaired === missing.length
}

const jobIds = process.argv.slice(2).filter((a) => !a.startsWith("-"))
if (jobIds.length === 0) {
  console.error("Usage: npx tsx scripts/recover-job-media.ts <jobId> [jobId...]")
  process.exit(1)
}

let allOk = true
for (const jobId of jobIds) {
  try {
    if (!(await recoverJob(jobId))) allOk = false
  } catch (err) {
    console.error(`  ✗ unexpected error for ${jobId}:`, err instanceof Error ? err.message : err)
    allOk = false
  }
}
process.exit(allOk ? 0 : 1)

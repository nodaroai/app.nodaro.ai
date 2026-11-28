// @reads-none Reads only the downloaded video in this worker's temporary directory.
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { join } from "node:path"
import { cleanupWorkDir, createWorkDir, downloadFile } from "../providers/video/ffmpeg-utils.js"
import { hasCredits } from "./config.js"
import { getJobId, JobCancelledError } from "./job-cancellation.js"
import {
  deleteUnnamedDeliveredObject, deliveredKeepsKey, discardJustStored,
  readServerOutput, recordStoredObjectAndCharge, storeBeginTime,
} from "./job-server-output.js"
import { headR2Object, mediaObjectKey, r2Url } from "./storage.js"
import { supabase } from "./supabase.js"
import { storeVideoResult } from "./video-result-store.js"

export interface ProDeliveryClipInput {
  jobId: string; userId?: string; segment: number; sourceUrl: string; watermark: boolean
}

/** A worker may retry with a new scratch URL for the same video. Hash the exact
 * file the store will encode so a different take or watermark never aliases it. */
export async function storeProDeliveryClip({ jobId, userId, segment, sourceUrl, watermark }: ProDeliveryClipInput): Promise<string> {
  if (getJobId() !== jobId || !Number.isSafeInteger(segment) || segment < 1) throw new Error("Invalid Pro delivery part")
  // trash-read: authenticates the running Pro job and observes its publication state.
  const { data: job, error } = await supabase.from("jobs").select("user_id, job_type, should_watermark, status, deleted_at").eq("id", jobId).maybeSingle()
  if (error || !job || job.deleted_at || (userId && userId !== job.user_id) ||
      (job.job_type !== "generate-video-pro" && job.job_type !== "edit-video-pro")) throw new Error("Cannot verify the Pro delivery job")
  if (job.status === "cancelled" || job.status === "failed") throw new JobCancelledError(jobId)
  const requiredWatermark = watermark || job.should_watermark === true
  const dir = await createWorkDir("pro-delivery")
  try {
    const path = join(dir, "source.mp4")
    await downloadFile(sourceUrl, path)
    const hash = createHash("sha256").update(`${jobId}:${segment}:${requiredWatermark}:`)
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    const part = `delivery-${segment}-${hash.digest("hex")}`
    const key = mediaObjectKey(`${jobId}-${part}`, "video")
    const url = r2Url(key)
    const existing = await headR2Object(key)
    if (job.status === "completed" || job.status === "pending_review") {
      if (existing.sizeBytes && await deliveredKeepsKey(jobId, key) === "named") return url
      throw new Error("This delivery has already ended")
    }
    const begunAt = await storeBeginTime()
    if (!begunAt) throw new Error("Cannot begin tracking the delivery part")
    let size = existing.sizeBytes
    if (!existing.exists || existing.sizeBytes === 0) {
      // A job that ends or a worker that dies between uploads must still have a
      // record to clean. Zero bytes makes no quota charge before the upload.
      const staged = await recordStoredObjectAndCharge({ jobId, key, bytes: 0, begunAt })
      if (staged.outcome !== "recorded") throw new Error("Could not stage the delivery part")
      const stored = await storeVideoResult({ path }, { jobId: `${jobId}-${part}`, userId: undefined, watermark: requiredWatermark, original: "never" })
      if (stored.videoUrl !== url) throw new Error("Unexpected delivery object")
      size = (await headR2Object(key)).sizeBytes
    }
    if (!size || !Number.isSafeInteger(size) || size <= 0) throw new Error("Could not measure the delivery part")
    const receipt = await recordStoredObjectAndCharge({ jobId, key, bytes: size, begunAt })
    switch (receipt.outcome) {
      case "recorded":
        // A lost RPC reply may be recovered by seeing the key from our zero-byte
        // staging record. Confirm its charged bytes before publishing it.
        if (receipt.charged === 0 && job.user_id && hasCredits() && ((await readServerOutput(jobId)).serverOutput.stored?.[key] ?? 0) < size) {
          throw new Error("Could not confirm the delivery part's storage receipt")
        }
        return url
      case "delivered":
        if (await deliveredKeepsKey(jobId, key) === "named") return url
        await deleteUnnamedDeliveredObject(jobId, key)
        break
      case "ended":
        await discardJustStored(jobId, key, "ended")
        throw new JobCancelledError(jobId)
      case "unrecorded":
        await discardJustStored(jobId, key, "unrecorded")
        break
      case "unknown":
        // This store registered the key before uploading. Its job's terminal
        // pruner owns cleanup; another finalizer could already be publishing it.
        break
    }
    throw new Error("Could not confirm publication of the delivery part")
  } finally {
    await cleanupWorkDir(dir)
  }
}

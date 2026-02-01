import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { generateImage } from "../providers/image/replicate.js"
import { uploadToR2 } from "../lib/storage.js"

export function createVideoWorker() {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-generation",
    async (job) => {
      const { jobId, prompt } = job.data as { jobId: string; prompt: string }
      console.log(`Processing job ${jobId}: "${prompt}"`)

      try {
        await supabase
          .from("jobs")
          .update({ status: "processing", started_at: new Date().toISOString() })
          .eq("id", jobId)

        console.log(`Calling Replicate for job ${jobId}...`)
        const replicateUrl = await generateImage(prompt)
        console.log(`Replicate returned: ${replicateUrl}`)

        await job.updateProgress(50)

        console.log(`Uploading to R2 for job ${jobId}...`)
        const r2Url = await uploadToR2(replicateUrl, jobId)
        console.log(`R2 upload complete: ${r2Url}`)

        await job.updateProgress(100)

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            progress: 100,
            output_data: { imageUrl: r2Url },
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        console.log(`Job ${jobId} completed successfully`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        console.error(`Job ${jobId} failed:`, message)

        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        throw err
      }
    },
    { connection, concurrency: 2 },
  )
}

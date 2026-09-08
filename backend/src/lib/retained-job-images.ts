import { supabase } from "./supabase.js"
import { retainImage, readRetainedImage, type RetainedImage } from "./retained-images.js"
import { safeFetchBytes } from "./safe-fetch-bytes.js"

export interface RetainedJobImage {
  jobId: string
  submissionContext: Record<string, unknown>
  image: RetainedImage
}
interface RecordRow {
  job_id: string; user_id: string; workflow_id: string; image_id: string
  submission_context: Record<string, unknown>
}
const COLUMNS = "job_id,user_id,workflow_id,image_id,submission_context"

async function verified(row: RecordRow): Promise<RetainedJobImage> {
  const image = await readRetainedImage(row.workflow_id, row.image_id)
  if (!image) throw new Error("The retained job image is unavailable")
  return { jobId: row.job_id, submissionContext: row.submission_context, image }
}

/** Call only after authorizing access to the destination workflow. Its existing
 * results remain readable across collaborators and after job/account deletion. */
export async function readRetainedJobImages(workflowId: string, jobIds: readonly string[]): Promise<RetainedJobImage[]> {
  const ids = [...new Set(jobIds)].filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.from("retained_job_images").select(COLUMNS)
    .eq("workflow_id", workflowId).in("job_id", ids)
  if (error) throw new Error("Failed to read retained job images")
  const results: RetainedJobImage[] = []
  for (const row of (data ?? []) as unknown as RecordRow[]) results.push(await verified(row))
  return results
}

/** Authorize workflow editing before calling. A new capture additionally proves
 * job ownership, workflow binding, terminal approval and server submission data.
 * It fetches public HTTP bytes, never an editable key with origin credentials. */
export async function retainJobImage(args: { userId: string; workflowId: string; jobId: string }): Promise<RetainedJobImage | null> {
  const prior = await readRetainedJobImages(args.workflowId, [args.jobId])
  if (prior.length) return prior[0]!
  const { data, error } = await supabase.from("jobs")
    .select("id,output_data,submission_context")
    .eq("id", args.jobId).eq("user_id", args.userId).eq("workflow_id", args.workflowId)
    .eq("status", "completed").in("job_type", ["generate-image", "image-to-image"]).maybeSingle()
  if (error) throw new Error("Failed to read the completed image job")
  if (!data?.submission_context) return null
  const source = (data.output_data as { imageUrl?: unknown } | null)?.imageUrl
  if (typeof source !== "string" || !/^https?:\/\//.test(source)) return null
  const image = await retainImage({ userId: args.userId, workflowId: args.workflowId,
    body: await safeFetchBytes(source, 25 * 1024 * 1024) })
  const recorded = await supabase.rpc("record_retained_job_image", {
    p_user_id: args.userId, p_workflow_id: args.workflowId, p_job_id: args.jobId,
    p_image_id: image.assetId, p_source_url: source,
  })
  if (recorded.error) throw new Error("Failed to record the retained job image")
  if (!recorded.data) return null
  // A concurrent capture may have won; use its identity, not our local copy.
  return verified(recorded.data as unknown as RecordRow)
}

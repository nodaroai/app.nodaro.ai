import { supabase } from "./supabase.js"
import { retainVideo, readRetainedVideo, type RetainedVideo } from "./retained-videos.js"
import { boundedPublicChunks } from "./safe-fetch-bytes.js"

export interface RetainedJobVideo {
  jobId: string
  submissionContext: Record<string, unknown>
  video: RetainedVideo
}
interface RecordRow {
  job_id: string; user_id: string; workflow_id: string; video_id: string
  submission_context: Record<string, unknown>
}
const COLUMNS = "job_id,user_id,workflow_id,video_id,submission_context"

async function verified(row: RecordRow): Promise<RetainedJobVideo> {
  const video = await readRetainedVideo(row.workflow_id, row.video_id)
  if (!video) throw new Error("The retained job video is unavailable")
  return { jobId: row.job_id, submissionContext: row.submission_context, video }
}

/** Call only after authorizing access to the destination workflow. Its existing
 * results remain readable across collaborators and after job/account deletion. */
export async function readRetainedJobVideos(workflowId: string, jobIds: readonly string[]): Promise<RetainedJobVideo[]> {
  const ids = [...new Set(jobIds)].filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.from("retained_job_videos").select(COLUMNS)
    .eq("workflow_id", workflowId).in("job_id", ids)
  if (error) throw new Error("Failed to read retained job videos")
  const results: RetainedJobVideo[] = []
  for (const row of (data ?? []) as unknown as RecordRow[]) results.push(await verified(row))
  return results
}

/** Authorize workflow editing before calling. A new capture additionally proves
 * job ownership, workflow binding, terminal approval and server submission data.
 * It fetches public HTTP bytes, never an editable key with origin credentials. */
export async function retainJobVideo(args: { userId: string; workflowId: string; jobId: string }): Promise<RetainedJobVideo | null> {
  const prior = await readRetainedJobVideos(args.workflowId, [args.jobId])
  if (prior.length) return prior[0]!
  const { data, error } = await supabase.from("jobs")
    .select("id,output_data,submission_context")
    .eq("id", args.jobId).eq("user_id", args.userId).eq("workflow_id", args.workflowId)
    .eq("status", "completed").in("job_type", ["text-to-video", "image-to-video"]).maybeSingle()
  if (error) throw new Error("Failed to read the completed video job")
  if (!data?.submission_context) return null
  const source = (data.output_data as { videoUrl?: unknown } | null)?.videoUrl
  if (typeof source !== "string" || !/^https?:\/\//.test(source)) return null
  const video = await retainVideo({ userId: args.userId, workflowId: args.workflowId,
    body: await downloadVideo(source) })
  const recorded = await supabase.rpc("record_retained_job_video", {
    p_user_id: args.userId, p_workflow_id: args.workflowId, p_job_id: args.jobId,
    p_video_id: video.assetId, p_source_url: source,
  })
  if (recorded.error) throw new Error("Failed to record the retained job video")
  if (!recorded.data) return null
  // A concurrent capture may have won; use its identity, not our local copy.
  return verified(recorded.data as unknown as RecordRow)
}

async function downloadVideo(source: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of boundedPublicChunks(source, { maxBytes: 500 * 1024 * 1024, timeoutMs: 120_000, label: "Video" })) {
    chunks.push(chunk); length += chunk.length
  }
  return Buffer.concat(chunks, length)
}

import { supabase } from "./supabase.js"
import { readRetainedVideo, type RetainedVideo } from "./retained-videos.js"

export interface RetainedVideoCopy {
  id: string
  source: { workflowId: string; jobId?: string; copyId?: string }
  sourceContext: Record<string, unknown>
  origin: { workflowId: string; jobId: string; submissionContext: Record<string, unknown> }
  context: Record<string, unknown>
  video: RetainedVideo
}
interface CopyRow {
  id: string; workflow_id: string; video_id: string; source_workflow_id: string; source_job_id: string | null;
  source_copy_id: string | null; source_context: Record<string, unknown>; origin_workflow_id: string;
  origin_job_id: string; origin_submission_context: Record<string, unknown>; context: Record<string, unknown>
}
const COLUMNS = "id,workflow_id,video_id,source_workflow_id,source_job_id,source_copy_id,source_context,origin_workflow_id,origin_job_id,origin_submission_context,context"

async function verified(row: CopyRow): Promise<RetainedVideoCopy> {
  const video = await readRetainedVideo(row.workflow_id, row.video_id)
  if (!video) throw new Error("The copied video is unavailable")
  return { id: row.id, source: { workflowId: row.source_workflow_id,
    ...(row.source_job_id ? { jobId: row.source_job_id } : {}), ...(row.source_copy_id ? { copyId: row.source_copy_id } : {}) },
  sourceContext: row.source_context,
  origin: { workflowId: row.origin_workflow_id, jobId: row.origin_job_id, submissionContext: row.origin_submission_context },
  context: row.context, video }
}

/** Authorize workflow read access first. Does not consult a deleted source. */
export async function readRetainedVideoCopies(workflowId: string, copyIds: readonly string[]): Promise<RetainedVideoCopy[]> {
  const ids = [...new Set(copyIds)].filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.from("retained_video_copies").select(COLUMNS).eq("workflow_id", workflowId).in("id", ids)
  if (error) throw new Error("Failed to read copied video proofs")
  const copies: RetainedVideoCopy[] = []
  for (const row of (data ?? []) as CopyRow[]) copies.push(await verified(row))
  return copies
}

/** Trusted integration only: authorize both workflows and validate mapped
 * context before calling. Source provenance is copied by the database itself. */
export async function recordRetainedVideoCopy(args: {
  id: string; userId: string; workflowId: string; videoId: string;
  source: { workflowId: string; jobId: string; copyId?: never } | { workflowId: string; copyId: string; jobId?: never };
  context: Record<string, unknown>
}): Promise<RetainedVideoCopy | null> {
  const { data, error } = await supabase.rpc("record_retained_video_copy", { p_id: args.id, p_user_id: args.userId,
    p_workflow_id: args.workflowId, p_video_id: args.videoId, p_source_workflow_id: args.source.workflowId,
    p_source_job_id: args.source.jobId ?? null, p_source_copy_id: args.source.copyId ?? null, p_context: args.context })
  if (error) throw new Error("Failed to record copied video proof")
  if (!data) return null
  return verified(data as CopyRow)
}

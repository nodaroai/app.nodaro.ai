import { supabase } from "./supabase.js"
import { readRetainedImage, type RetainedImage } from "./retained-images.js"

export interface RetainedImageCopy {
  id: string
  source: { workflowId: string; jobId?: string; copyId?: string }
  sourceContext: Record<string, unknown>
  origin: { workflowId: string; jobId: string; submissionContext: Record<string, unknown> }
  context: Record<string, unknown>
  image: RetainedImage
}
interface CopyRow {
  id: string; workflow_id: string; image_id: string; source_workflow_id: string; source_job_id: string | null;
  source_copy_id: string | null; source_context: Record<string, unknown>; origin_workflow_id: string;
  origin_job_id: string; origin_submission_context: Record<string, unknown>; context: Record<string, unknown>
}
const COLUMNS = "id,workflow_id,image_id,source_workflow_id,source_job_id,source_copy_id,source_context,origin_workflow_id,origin_job_id,origin_submission_context,context"

async function verified(row: CopyRow): Promise<RetainedImageCopy> {
  const image = await readRetainedImage(row.workflow_id, row.image_id)
  if (!image) throw new Error("The copied image is unavailable")
  return { id: row.id, source: { workflowId: row.source_workflow_id,
    ...(row.source_job_id ? { jobId: row.source_job_id } : {}), ...(row.source_copy_id ? { copyId: row.source_copy_id } : {}) },
  sourceContext: row.source_context,
  origin: { workflowId: row.origin_workflow_id, jobId: row.origin_job_id, submissionContext: row.origin_submission_context },
  context: row.context, image }
}

/** Authorize workflow read access first. Does not consult a deleted source. */
export async function readRetainedImageCopies(workflowId: string, copyIds: readonly string[]): Promise<RetainedImageCopy[]> {
  const ids = [...new Set(copyIds)].filter(Boolean)
  if (!ids.length) return []
  const { data, error } = await supabase.from("retained_image_copies").select(COLUMNS).eq("workflow_id", workflowId).in("id", ids)
  if (error) throw new Error("Failed to read copied image proofs")
  const copies: RetainedImageCopy[] = []
  for (const row of (data ?? []) as CopyRow[]) copies.push(await verified(row))
  return copies
}

/** Trusted integration only: authorize both workflows and validate mapped
 * context before calling. Source provenance is copied by the database itself. */
export async function recordRetainedImageCopy(args: {
  id: string; userId: string; workflowId: string; imageId: string;
  source: { workflowId: string; jobId: string; copyId?: never } | { workflowId: string; copyId: string; jobId?: never };
  context: Record<string, unknown>
}): Promise<RetainedImageCopy | null> {
  const { data, error } = await supabase.rpc("record_retained_image_copy", { p_id: args.id, p_user_id: args.userId,
    p_workflow_id: args.workflowId, p_image_id: args.imageId, p_source_workflow_id: args.source.workflowId,
    p_source_job_id: args.source.jobId ?? null, p_source_copy_id: args.source.copyId ?? null, p_context: args.context })
  if (error) throw new Error("Failed to record copied image proof")
  if (!data) return null
  return verified(data as CopyRow)
}

import { stopsAtSegmentBoundary } from "./stop-rule.js"
import { JobCancelledError, JobStopRequestedError } from "./job-cancellation.js"

/** Serialize the first paid submit with cancellation, including lanes whose raw task cannot be recovered as the final clip. */
export async function markVideoSendStarted(jobId: string): Promise<void> {
  // A database without the marker column (its schema is not applied yet) sends as it did before the marker existed.
  if (!(await (await import("./video-route-schema.js")).videoRouteSchemaReady())) return
  const { supabase } = await import("./supabase.js")
  const { data, error } = await supabase.from("jobs")
    .update({ video_send_started_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["pending", "queued", "processing"])
    .select("id")
  if (error) throw error
  if (!data?.length) throw new JobCancelledError(jobId)
}


/** A multi-step video stop and each subsequent segment or take submit serialize on the same job row. */
export async function beginPlannedVideoSegment(jobId: string, knownParent = false): Promise<void> {
  // A database without the marker column (its schema is not applied yet) sends as it did before the marker existed.
  if (!(await (await import("./video-route-schema.js")).videoRouteSchemaReady())) return
  const { supabase } = await import("./supabase.js")
  if (!knownParent) {
    // trash-read: submit serialization inspects the executing job, never a user-facing result
    const { data, error } = await supabase.from("jobs").select("job_type").eq("id", jobId).maybeSingle()
    if (error) throw error
    if (!stopsAtSegmentBoundary({ job_type: data?.job_type })) return
  }
  const { data, error } = await supabase.from("jobs").update({ video_send_started_at: new Date().toISOString() })
    .eq("id", jobId).in("status", ["pending", "queued", "processing"]).is("stop_requested_at", null).select("id")
  if (error) throw error
  if (data?.length) return
  // trash-read: classify a failed submit CAS so a deleted running job can still stop
  const row = await supabase.from("jobs").select("status, stop_requested_at").eq("id", jobId).maybeSingle()
  if (row.error) throw row.error
  if (row.data?.stop_requested_at && row.data.status !== "cancelled") throw new JobStopRequestedError(jobId)
  throw new JobCancelledError(jobId)
}

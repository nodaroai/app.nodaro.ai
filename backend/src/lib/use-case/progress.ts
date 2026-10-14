/**
 * The wrapper's progress mirrors the inner run (completed / total nodes), so
 * the canvas node, the MCP widget and GET /v1/jobs show it like any job.
 * Best-effort; never moves a finished wrapper (CAS on processing); capped at
 * 99 — 100 is written by markJobCompleted.
 */
import { supabase } from "../supabase.js"

export async function mirrorUseCaseProgress(wrapperJobId: string, completed: number, total: number): Promise<void> {
  if (!(total > 0)) return
  const progress = Math.max(0, Math.min(99, Math.round((completed / total) * 100)))
  await supabase.from("jobs").update({ progress }).eq("id", wrapperJobId).eq("status", "processing")
}

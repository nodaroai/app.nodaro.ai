/**
 * Block until a Nodaro job reaches a terminal state, then return its
 * output URL.
 *
 * Why this exists: clients like Cursor 3.2.16 cancel tool calls that
 * return immediately without a "real" result — they expect synchronous
 * completion. Stateless MCP transport can't deliver async progress
 * notifications back to the caller after the response closes, so the
 * only way to give Cursor a complete result is to keep the request open
 * and poll until the worker finishes.
 *
 * Trade-off: ties up the Fastify worker for ~10–60s per image (longer
 * for video). The MCP route is configured with a generous timeout to
 * allow this. Hosts like Claude.ai prefer the widget-based async UX —
 * they get the same final URL but rendered live via the iframe — but
 * the underlying job is the same; this helper just doesn't return until
 * the URL is known either way.
 */
import { supabase } from "../../supabase.js"

const POLL_INTERVAL_MS = 1500

interface WaitForJobOpts {
  jobId: string
  /** Maximum wall-clock to wait. Defaults: 120s (image), 300s (video/other). */
  timeoutMs?: number
}

interface WaitForJobResult {
  status: "completed" | "failed" | "cancelled" | "timeout"
  outputUrl: string | null
  /** Full output_data payload — useful when callers need video/audio URLs alongside thumbnail. */
  outputData: Record<string, unknown> | null
  error: string | null
  jobType: string | null
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

export async function waitForJob(opts: WaitForJobOpts): Promise<WaitForJobResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from("jobs")
      .select("status, output_data, job_type, error_message")
      .eq("id", opts.jobId)
      .maybeSingle()

    if (error) {
      return {
        status: "failed",
        outputUrl: null,
        outputData: null,
        error: `DB error while polling: ${error.message}`,
        jobType: null,
      }
    }
    if (!data) {
      return {
        status: "failed",
        outputUrl: null,
        outputData: null,
        error: `Job ${opts.jobId} not found`,
        jobType: null,
      }
    }

    const status = (data.status as string) ?? "pending"
    const jobType = (data.job_type as string | null) ?? null

    if (TERMINAL_STATUSES.has(status)) {
      const out = (data.output_data ?? {}) as Record<string, unknown>
      const outputUrl =
        (out.imageUrl as string | undefined) ??
        (out.videoUrl as string | undefined) ??
        (out.audioUrl as string | undefined) ??
        (out.outputUrl as string | undefined) ??
        (out.url as string | undefined) ??
        null
      return {
        status: status as "completed" | "failed" | "cancelled",
        outputUrl,
        outputData: out,
        error: (data.error_message as string | null) ?? null,
        jobType,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return {
    status: "timeout",
    outputUrl: null,
    outputData: null,
    error: `Job ${opts.jobId} did not complete within ${timeoutMs}ms`,
    jobType: null,
  }
}

export interface PeekJobResult {
  /** True if the job is in a terminal state. */
  done: boolean
  /** Resolved output URL if the job completed and produced media. */
  outputUrl: string | null
  /** Raw status string from the jobs table ("pending", "processing", "completed", …). */
  status: string
}

/**
 * Single non-blocking status check. Used as a short-circuit at tool-call
 * time: if the worker happened to finish before this MCP tool handler
 * returned (cache hit, very fast provider response), the verb passes the
 * resolved URL straight through to the widget so it shows the image
 * without entering its 2 s poll loop. Otherwise this is a no-op except
 * for one DB round-trip.
 */
export async function peekJob(jobId: string): Promise<PeekJobResult> {
  const { data, error } = await supabase
    .from("jobs")
    .select("status, output_data")
    .eq("id", jobId)
    .maybeSingle()
  if (error || !data) return { done: false, outputUrl: null, status: "unknown" }
  const status = (data.status as string) ?? "pending"
  if (!TERMINAL_STATUSES.has(status)) {
    return { done: false, outputUrl: null, status }
  }
  const out = (data.output_data ?? {}) as Record<string, unknown>
  const outputUrl =
    (out.imageUrl as string | undefined) ??
    (out.videoUrl as string | undefined) ??
    (out.audioUrl as string | undefined) ??
    (out.outputUrl as string | undefined) ??
    (out.url as string | undefined) ??
    null
  return { done: true, outputUrl, status }
}

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

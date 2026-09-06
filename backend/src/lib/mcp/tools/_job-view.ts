/**
 * THE ONE JOB ENVELOPE (audit 2026-09-06 fix #2 — A-5 / A-12).
 *
 * Two readers, two shapes: `get_job` returned the raw row as text with the
 * per-type output keys (`imageUrl` / `videoUrl` / `audioUrl` …), `get_asset`
 * a normalised object with an outputSchema — and every verb pointed the
 * agent at the weaker one. `jobView` is the single normalisation both readers
 * (and `wait_for_job`) declare and emit as `structuredContent`; the text
 * envelopes stay what they were for existing clients.
 */
import { z } from "zod"
import { redactPrivateJobData } from "../../public-job-data.js"
import { failureGuidance } from "./_job-error.js"

/** The public asset URL of a job's output — whichever per-type key it used. */
export function resolveOutputUrl(out: Record<string, unknown> | null | undefined): string | null {
  if (!out) return null
  return (
    (out.imageUrl as string | undefined) ??
    (out.videoUrl as string | undefined) ??
    (out.audioUrl as string | undefined) ??
    (out.outputUrl as string | undefined) ??
    (out.url as string | undefined) ??
    null
  )
}

/** image / video / audio by the output key present; null for text, component and empty outputs. */
export function assetKindOf(out: Record<string, unknown> | null | undefined): "image" | "video" | "audio" | null {
  if (!out) return null
  return out.imageUrl ? "image" : out.videoUrl ? "video" : out.audioUrl ? "audio" : null
}

export const HELD_JOB_GUIDANCE =
  "This job finished generating but its output is held for human review and is " +
  "deliberately withheld. Do NOT re-run it — a duplicate would be held too, and " +
  "charged again. Poll `get_job` later: the output appears when the review approves " +
  "it, or the job becomes `failed` with a policy reason if it is rejected."

export const JOB_VIEW_SCHEMA = {
  jobId: z.string(),
  /** pending | processing | completed | failed | cancelled | pending_review — plus `timeout` / `aborted` from wait_for_job. */
  status: z.string(),
  progress: z.number().nullable().optional(),
  jobType: z.string().nullable().optional(),
  assetKind: z.string().nullable().optional(),
  outputUrl: z.string().nullable().optional(),
  outputData: z.record(z.string(), z.unknown()).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  /** On failed/cancelled/pending_review: false means the same request will fail (or be held) again — change the input, do not re-run. */
  retryable: z.boolean().optional(),
  guidance: z.string().optional(),
  suggestedProvider: z.string().optional(),
  credits: z.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
}

export type JobView = z.infer<z.ZodObject<typeof JOB_VIEW_SCHEMA>>

export interface JobRowLike {
  id: string
  status?: string | null
  progress?: number | null
  job_type?: string | null
  output_data?: Record<string, unknown> | null
  error_message?: string | null
  error_hint?: unknown
  credits?: number | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

/** Normalise a jobs row (public columns) into the envelope. Private remux bases are redacted. */
export function jobView(row: JobRowLike): JobView {
  const status = row.status ?? "pending"
  const out = row.output_data ? redactPrivateJobData(row.output_data as Record<string, unknown>) : null
  const view: JobView = {
    jobId: row.id,
    status,
    progress: row.progress ?? null,
    jobType: row.job_type ?? null,
    assetKind: assetKindOf(out),
    outputUrl: resolveOutputUrl(out),
    outputData: out,
    errorMessage: row.error_message ?? null,
    credits: row.credits ?? null,
    createdAt: row.created_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  }
  if (status === "failed" || status === "cancelled") {
    const g = failureGuidance({ error_message: row.error_message ?? null, error_hint: row.error_hint })
    view.retryable = g.retryable
    view.guidance = g.guidance
    if (g.suggestedProvider) view.suggestedProvider = g.suggestedProvider
  } else if (status === "pending_review") {
    view.retryable = false
    view.guidance = HELD_JOB_GUIDANCE
  }
  return view
}

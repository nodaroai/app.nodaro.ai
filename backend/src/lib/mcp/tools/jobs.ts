import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { isUuid } from "./_id-guard.js"
import { failureGuidance } from "./_job-error.js"
import { redactPrivateJobData } from "../../public-job-data.js"
import { JOB_STATUSES } from "../../job-status.js"
import { jobView, JOB_VIEW_SCHEMA } from "./_job-view.js"
import { waitForJob } from "./_wait-for-job.js"

const jobsReadGate: ToolGate = { required: ["jobs:read"] }

export interface RegisterJobsOpts {
  server: McpServer
  session: McpSession
  /**
   * Kept on the opts shape for symmetry with other registrars and so a
   * future v1.2 tool can hop to `mcpInject()` if a route grows MCP-specific
   * shaping. The current handlers query Supabase directly because the GET
   * endpoints' Fastify auth path requires `req.userId` set from a request
   * body, and GETs have no body.
   */
  fastify: FastifyInstance
}

/**
 * Job-discovery tools.
 *
 * v1.1 only ships single-shot reads (`list_jobs`, `get_job`); v1.2 will add
 * `tasks/get` long-poll for in-flight jobs. We query Supabase directly,
 * filtered by `session.userId`, because:
 *  1. The OAuth scope (`jobs:read`) is already gated at the MCP layer.
 *  2. The HTTP routes' user resolution path doesn't apply for GETs over
 *     `mcpInject()` (no body to carry `userId`).
 */
export function registerJobs({ server, session }: RegisterJobsOpts): void {
  if (!passesGate(session, jobsReadGate)) return

  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs (raw data)",
      description:
        "Raw structured listing of the user's jobs. Returns JSON only — " +
        "no widget, no thumbnails. Use `browse_gallery` instead when the " +
        "user wants to SEE their gallery / library (renders a clickable " +
        "image grid). Use this tool only when the agent needs structured " +
        "fields (status, error_message, credits, timestamps) for " +
        "programmatic logic — e.g. \"how many failed yesterday\", \"how " +
        "many credits did I burn this week\".",
      inputSchema: {
        scope: z
          .enum(["mine", "public"])
          .optional()
          .describe(
            "`mine` (default) returns the authenticated user's own " +
            "library. `public` returns recent public outputs from " +
            "OTHER users (excludes the caller's own items, mirroring " +
            "the web app's public gallery) — only use when the user " +
            "explicitly asks for the public gallery / trending / what " +
            "others are making.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max items to return (default 50, max 200)."),
        cursor: z
          .string()
          .optional()
          .describe("ISO `created_at` timestamp from a prior result's `next_cursor`"),
        // Derived from the canonical vocabulary, never re-typed: a hand-rolled
        // copy silently rejects the next status the platform adds (it rejected
        // `pending_review` on day one of the job-policy hook).
        status: z.enum(JOB_STATUSES).optional(),
        kinds: z
          .array(z.enum(["image", "video", "audio"]))
          .min(1)
          .optional()
          .describe(
            "Media kinds to include. Default: `[\"image\", \"video\"]` " +
            "— skips audio because most users browse visual generations. " +
            "Pass any combination explicitly: `[\"audio\"]` for music / " +
            "TTS only, `[\"image\", \"video\", \"audio\"]` for " +
            "everything, etc.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 50
      const scope = args.scope ?? "mine"
      // display_cost (USD) intentionally excluded — MCP surfaces only the
      // credits abstraction; raw $ pricing is internal/admin and distracts
      // the agent's response (Claude was rendering "" in chat for
      // every job before this was stripped).
      const baseSelect =
        "id, status, progress, input_data, output_data, error_message, created_at, completed_at, job_type, credits"
      // Build the filter chain BEFORE order/limit so the supabase mock
      // chain in tests (.from().select().eq().order().limit()) matches.
      // For the public gallery, force is_public=true, status=completed,
      // AND user_id != caller — same as the web app's public gallery
      // which never shows the caller their own items.
      let filtered =
        scope === "mine"
          ? supabase.from("jobs").select(baseSelect).eq("user_id", session.userId)
          : supabase
              .from("jobs")
              .select(baseSelect)
              .eq("is_public", true)
              .eq("status", "completed")
              .neq("user_id", session.userId)
      if (args.cursor) filtered = filtered.lt("created_at", args.cursor)
      if (scope === "mine" && args.status) filtered = filtered.eq("status", args.status)
      const query = filtered.order("created_at", { ascending: false }).limit(limit)
      const { data, error } = await query
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      let rows = data ?? []
      // Map of media kind → set of job_type strings that produce that
      // media. Filtering happens in JS rather than in the SQL query so a
      // multi-kind selection (e.g. ["image", "video"]) is just a set
      // union — keeps the query simple and avoids a giant `.in(...)`.
      const setForKind: Record<string, string[]> = {
        image: [
          "generate-image",
          "image-to-image",
          "edit-image",
          "generate-character",
          "generate-character-asset",
          "generate-location",
          "generate-location-asset",
          "generate-object",
          "generate-object-asset",
          "generate-creature",
          "generate-creature-asset",
        ],
        video: [
          "image-to-video",
          "text-to-video",
          "generate-video",
          "video-to-video",
          "lip-sync",
          "motion-transfer",
          "extend-video",
          "combine-videos",
          "add-captions",
          "extract-frame",
        ],
        audio: [
          "text-to-speech",
          "generate-music",
          "text-to-audio",
          "extract-youtube-audio",
        ],
      }
      // Default kinds: image + video. Audio is opt-in because most users
      // browse for visual generations; surfacing TTS / music outputs by
      // default clutters the gallery view. Caller can pass `["audio"]`
      // or `["image","video","audio"]` etc. for any combination.
      const kinds = args.kinds ?? ["image", "video"]
      const allowed = new Set(kinds.flatMap((k) => setForKind[k] ?? []))
      rows = rows.filter((r) => r.job_type && allowed.has(r.job_type as string))
      rows = redactPrivateJobData(rows)
      const last = rows[rows.length - 1]
      const nextCursor =
        rows.length === limit && last?.created_at ? (last.created_at as string) : null
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: rows, next_cursor: nextCursor }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    "get_job",
    {
      title: "Get Job",
      description:
        "Fetch one of your jobs by id. structuredContent is the job envelope: status (pending | processing | completed | failed | cancelled | pending_review), " +
        "progress, jobType, assetKind, outputUrl (the finished image/video/audio), outputData, errorMessage, credits and timestamps; on failed/cancelled/pending_review " +
        "also retryable, guidance and — for a safety block with a catalog fallback — suggestedProvider. " +
        "Poll every 5–10 s (an image usually finishes within a minute, a video in 2–10 minutes), or call wait_for_job to block up to 120 s.",
      inputSchema: {
        job_id: z.string().min(1),
      },
      outputSchema: JOB_VIEW_SCHEMA,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      // Guard the uuid PK before querying — a non-UUID id (KIE task id,
      // app-run id, truncated id, pasted URL) would make Postgres throw
      // `invalid input syntax for type uuid` and the handler would forward
      // that raw error. A non-UUID can't be a job we hold, so it is simply
      // "not found".
      if (!isUuid(args.job_id)) {
        return {
          content: [
            { type: "text", text: `Job ${args.job_id} not found (expected a job UUID)` },
          ],
          isError: true,
        }
      }
      const { data, error } = await supabase
        .from("jobs")
        .select(
          // display_cost (USD) excluded — see list_jobs comment above.
          // error_hint (migration 376) backs failureGuidance's suggestedProvider.
          "id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, job_type, credits, user_id",
        )
        .eq("id", args.job_id)
        .eq("user_id", session.userId)
        .maybeSingle()
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      if (!data) {
        return {
          content: [{ type: "text", text: `Job ${args.job_id} not found` }],
          isError: true,
        }
      }
      // On failure, add an explicit `retryable` flag (mirrors get_asset) plus
      // `guidance` and — for a safety-block with a catalog fallback —
      // `suggestedProvider`, a real model id the SAME request can retry on.
      const publicData = redactPrivateJobData(data)
      const failed = publicData.status === "failed" || publicData.status === "cancelled"
      const payload = failed
        ? {
            data: publicData,
            ...failureGuidance({
              error_message: publicData.error_message as string | null,
              error_hint: (publicData as { error_hint?: unknown }).error_hint,
            }),
          }
        : publicData.status === "pending_review"
          ? {
              // A third branch, not a failure and not a plain read (spec
              // 2026-09-03-job-policy-hook-design §6.4): the job finished
              // generating and its output is deliberately withheld. Without
              // this the agent sees a status it has no vocabulary for, with a
              // null output_data, and re-runs the request — whose duplicate is
              // held too, at full provider cost.
              data: publicData,
              retryable: false,
              guidance:
                "This job finished generating but its output is held for human review and is " +
                "deliberately withheld. Do NOT re-run it — a duplicate would be held too, and " +
                "charged again. Poll `get_job` later: the output appears when the review approves " +
                "it, or the job becomes `failed` with a policy reason if it is rejected.",
            }
          : { data: publicData }
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        // The one envelope (audit 2026-09-06 fix #2): the text keeps its
        // `{ data, … }` shape for existing clients; hosts and agents that read
        // structuredContent get the same normalised view get_asset and
        // wait_for_job return.
        structuredContent: jobView(data as Parameters<typeof jobView>[0]),
      }
    },
  )

  // WAIT (audit 2026-09-06 fix #2, A-9 / D-7): the blocking alternative to
  // polling. Ownership is checked BEFORE waiting (the loop itself reads by id
  // only), the wait stops on the request's own signal, and a deadline is a
  // status (`timeout`) with next-step guidance, never an error — the job is
  // still running.
  server.registerTool(
    "wait_for_job",
    {
      title: "Wait For Job",
      description:
        "Block until one of your jobs finishes (up to timeout_s, max 120 s) and return the same job envelope get_job returns. " +
        "If the job is still running at the deadline the result is status `timeout` (not an error): call wait_for_job again or poll get_job. " +
        "A held job answers `pending_review` at once — do not re-run it. Use this instead of a tight get_job loop; for a long video render prefer polling every 5–10 s.",
      inputSchema: {
        job_id: z.string().min(1),
        timeout_s: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe("Seconds to wait before answering `timeout` (default 60, max 120)."),
      },
      outputSchema: JOB_VIEW_SCHEMA,
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      if (!isUuid(args.job_id)) {
        return { content: [{ type: "text", text: `Job ${args.job_id} not found (expected a job UUID)` }], isError: true }
      }
      const { data: own, error } = await supabase
        .from("jobs")
        .select("id")
        .eq("id", args.job_id)
        .eq("user_id", session.userId)
        .maybeSingle()
      if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true }
      if (!own) return { content: [{ type: "text", text: `Job ${args.job_id} not found` }], isError: true }
      const timeoutMs = (args.timeout_s ?? 60) * 1000
      const waited = await waitForJob({ jobId: args.job_id, timeoutMs, signal: extra?.signal })
      if (waited.status === "timeout" || waited.status === "aborted") {
        const view = { jobId: args.job_id, status: waited.status, outputUrl: null, outputData: null, errorMessage: null }
        const text =
          waited.status === "timeout"
            ? `Job ${args.job_id} is still running after ${args.timeout_s ?? 60} s. Call wait_for_job again, or poll get_job every 5–10 s.`
            : `Wait for job ${args.job_id} was cancelled by the client; the job itself keeps running — poll get_job.`
        return { content: [{ type: "text", text }], structuredContent: view }
      }
      // Terminal or held: read the full public row once so the envelope
      // carries credits, timestamps and the failure guidance.
      const { data: row } = await supabase
        .from("jobs")
        .select("id, status, progress, output_data, error_message, error_hint, created_at, started_at, completed_at, job_type, credits")
        .eq("id", args.job_id)
        .eq("user_id", session.userId)
        .maybeSingle()
      const view = row
        ? jobView(row as Parameters<typeof jobView>[0])
        : { jobId: args.job_id, status: waited.status, outputUrl: waited.outputUrl, outputData: waited.outputData, errorMessage: waited.error, jobType: waited.jobType }
      const summary =
        view.status === "completed"
          ? `Job ${args.job_id} completed${view.outputUrl ? `: ${view.outputUrl}` : ""}.`
          : view.status === "pending_review"
            ? `Job ${args.job_id} is held for review. ${view.guidance ?? ""}`
            : `Job ${args.job_id} ${view.status}${view.errorMessage ? `: ${view.errorMessage}` : ""}. ${view.guidance ?? ""}`
      return { content: [{ type: "text", text: summary.trim() }], structuredContent: view }
    },
  )
}

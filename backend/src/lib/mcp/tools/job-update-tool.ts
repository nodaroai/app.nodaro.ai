/**
 * `update_job` — the MCP face of `PATCH /v1/jobs/:id` (decided 2026-11-23):
 * the caller names one of their own jobs and/or sets its cover picture, or
 * clears either. The same rules as the route: lib/job-title.ts for the name,
 * lib/job-update.ts and lib/job-cover/ for the cover — the cover address's
 * shape included (lib/job-cover/cover-request.ts, shared with the route).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { isUuid } from "./_id-guard.js"
import { JOB_TITLE_MAX_CHARS, normalizeJobTitle } from "../../job-title.js"
import { updateJobOwnerFields } from "../../job-update.js"
import { JOB_COVER_PROBLEM_MESSAGE } from "../../job-cover/cover-source.js"
import { jobCoverUrlSchema, type JobCoverRequest } from "../../job-cover/cover-request.js"

const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true })

/** Where a failed update is logged: the server's logger (Fastify's), or the console when none is given. */
export interface UpdateJobLogger {
  error(fields: Record<string, unknown>, message: string): void
}

const consoleLogger: UpdateJobLogger = { error: (fields, message) => console.error(`[mcp] ${message}`, fields) }

/** The one cover the arguments name: an asset, an address, a clear, or none. Null when more than one is named. */
function coverOf(args: { cover_asset_id?: string; cover_url?: string; clear_cover?: boolean }): { cover: JobCoverRequest | null | undefined } | null {
  const named = [args.cover_asset_id !== undefined, args.cover_url !== undefined, args.clear_cover === true].filter(Boolean).length
  if (named > 1) return null
  if (args.cover_asset_id !== undefined) return { cover: { assetId: args.cover_asset_id } }
  if (args.cover_url !== undefined) return { cover: { url: args.cover_url } }
  return { cover: args.clear_cover ? null : undefined }
}

export function registerUpdateJob(server: McpServer, session: McpSession, log: UpdateJobLogger = consoleLogger): void {
  server.registerTool(
    "update_job",
    {
      title: "Update Job",
      description:
        "Rename one of your results and/or set its cover picture (any kind: a song, a speech take, a video, an image…). Free. " +
        "The cover is one of your images here — one you uploaded or generated (its asset id, or its address); clear_cover brings the provider's art back.",
      inputSchema: {
        job_id: z.string().min(1),
        title: z.string().max(JOB_TITLE_MAX_CHARS).nullable().optional().describe("The name, or null to clear it."),
        cover_asset_id: z.string().uuid().optional().describe("Your image to use as the cover: its asset id."),
        cover_url: jobCoverUrlSchema.optional().describe("Your image to use as the cover: its address on this platform's storage."),
        clear_cover: z.boolean().optional().describe("true: remove your cover."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const notFound = fail(`Job ${args.job_id} not found`)
      if (!isUuid(args.job_id)) return notFound
      const picked = coverOf(args)
      if (picked === null) return fail("Pass one of cover_asset_id, cover_url or clear_cover.")
      const { cover } = picked
      let title: string | null | undefined
      if (args.title !== undefined) {
        const normalized = normalizeJobTitle(args.title)
        if ("problem" in normalized) return fail(`title must be one line of plain text, at most ${JOB_TITLE_MAX_CHARS} characters.`)
        title = normalized.title
      }
      if (title === undefined && cover === undefined) return fail("Pass title, a cover, or clear_cover.")
      let outcome
      try {
        outcome = await updateJobOwnerFields(session.userId, args.job_id, {
          ...(title !== undefined ? { title } : {}),
          ...(cover !== undefined ? { cover } : {}),
        })
      } catch (err) {
        log.error({ err, jobId: args.job_id }, "update_job: the job could not be updated")
        return fail("Error: could not update the job — try again.")
      }
      if (outcome.kind === "not_found") return notFound
      if (outcome.kind === "invalid_cover") return fail(JOB_COVER_PROBLEM_MESSAGE[outcome.problem])
      if (outcome.kind === "conflict") return fail("Another change to this job's cover landed first — read the job and try again.")
      if (outcome.kind === "rate_limited") return fail(`Too many cover changes — try again in ${outcome.retryAfterSec}s.`)
      if (outcome.kind === "not_available") return fail(`Setting a job's ${outcome.field} is not available on this server yet.`)
      const { kind: _kind, ...fields } = outcome
      return { content: [{ type: "text", text: JSON.stringify({ data: { jobId: args.job_id, ...fields } }) }] }
    },
  )
}

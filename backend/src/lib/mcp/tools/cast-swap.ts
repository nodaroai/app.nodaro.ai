/**
 * MCP `cast_swap` — the agent's face of Cast Swap: replace the people and/or
 * the location in a short video with the user's reference images, keeping its
 * motion, framing, timing and sound.
 *
 * Price confirmation follows `render_final` / `retry_app_run`: without
 * `confirm` the tool returns the quote (`POST /v1/cast-swap/estimate` —
 * nothing is created or charged); `confirm: true`, only after the user
 * accepted it, runs (`POST /v1/cast-swap` → 202 `{ jobId }`), and the job is
 * followed with `get_job` / `wait_for_job` like any other.
 *
 * The route is the authority on every rule (role counts, the clip's length,
 * the post prompt's `{role:N}` mentions); this tool maps snake_case to the
 * route's body and leaves the rest to it. The user travels in `mcpInject`'s
 * header, never the body.
 *
 * Cloud-only: registered behind `hasCredits()` in server.ts — the routes are
 * the cloud plugin's, and a cloud boot without it answers `not_available`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { registerTask } from "../tasks.js"
import { isRouterNotFound } from "./_studio-helpers.js"
import { clientRequestIdSchema, errorResult, GET_JOB_POLL_HINT, idempotencyHeaders, parseJobId } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

const NOT_AVAILABLE = "Cast Swap is a Nodaro Cloud feature and is not served on this deployment."

export interface RegisterCastSwapToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

interface CastSwapQuote {
  totalCredits: number
  breakdown: { castSwap: number; seedance: number }
  settlesLower: boolean
}

const trait = z.enum(["new", "original"]).optional()
const images = z.array(z.string().url()).max(3).nullable().optional()

function refusal(statusCode: number, body: string) {
  if (isRouterNotFound(statusCode, body)) {
    return errorResult(404, JSON.stringify({ error: { code: "not_available", message: NOT_AVAILABLE } }))
  }
  return errorResult(statusCode, body)
}

export function registerCastSwapTools({ server, session, fastify }: RegisterCastSwapToolsOpts): void {
  if (!passesGate(session, executeGate)) return

  server.registerTool(
    "cast_swap",
    {
      title: "Cast Swap",
      description:
        "Replace the people and/or the place in a 4–30 s video with the user's reference images, keeping its motion, framing, timing and sound. " +
        "Each role names someone (or the setting) in the video and takes 0–3 images of ONE person or place; a role with none stays as in the video. " +
        "Without `confirm` it returns the PRICE QUOTE only (nothing is charged): show the credits to the user, and call again with `confirm: true` only once they accept. " +
        "That returns a job id: poll it with wait_for_job. `preview: true` renders 4 s first, a cheaper check of the look. " +
        "Image and video URLs must be http(s): upload local files with the upload tools first.",
      inputSchema: {
        video_url: z.string().url().describe("The source clip, 4–30 s."),
        roles: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("person"),
                name: z.string().min(1).describe('Who in the video, e.g. "the woman that attacks".'),
                images,
                body: trait.describe('"new" (default) from the images, or "original" from the video.'),
                outfit: trait.describe("As body."),
                hair: trait.describe("Hairstyle and haircut; as body."),
              }),
              z.object({
                kind: z.literal("location"),
                name: z.string().min(1).optional().describe('Default "the setting".'),
                images,
              }),
            ]),
          )
          .describe("At most 6 person roles and 1 location role. At least one role with images, or a post_prompt."),
        post_prompt: z
          .string()
          .max(4000)
          .optional()
          .describe("Extra instructions. Mention a role as {role:N}, N 1-based over roles (empty roles count)."),
        preview: z.boolean().optional().describe("true = render 4 s from preview_start."),
        preview_start: z.number().min(0).optional().describe("Seconds, default 0; preview_start + 4 must fit the clip."),
        quality: z.enum(["draft"]).optional().describe('"draft" (the default and only value today).'),
        session_id: z.string().min(1).optional().describe("A generation session to file the result in."),
        confirm: z.boolean().optional().describe("true ONLY after the user accepted the quoted credits in this conversation."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload = {
        videoUrl: args.video_url,
        roles: args.roles.map((role) => ({ ...role, images: role.images ?? null })),
        ...(args.post_prompt !== undefined ? { postPrompt: args.post_prompt } : {}),
        ...(args.preview !== undefined ? { preview: args.preview } : {}),
        ...(args.preview_start !== undefined ? { previewStart: args.preview_start } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      }

      if (args.confirm !== true) {
        const est = await mcpInject(fastify, session, { method: "POST", url: "/v1/cast-swap/estimate", payload })
        if (est.statusCode >= 400) return refusal(est.statusCode, est.body)
        let quote: CastSwapQuote
        try {
          const parsed = JSON.parse(est.body) as { data?: CastSwapQuote } & CastSwapQuote
          quote = parsed.data ?? parsed
        } catch {
          return { content: [{ type: "text" as const, text: "The Cast Swap quote could not be read." }], isError: true as const }
        }
        const lower = quote.settlesLower
          ? " The video's length is left to the model, so the final charge is expected to come out lower than this quote."
          : ""
        return {
          content: [
            {
              type: "text" as const,
              text:
                `This Cast Swap ${args.preview ? "preview " : ""}costs about ${quote.totalCredits} credits.${lower} ` +
                "Present this to the user; call cast_swap again with the same arguments and confirm: true once they accept.",
            },
          ],
          structuredContent: { ...quote, confirmed: false },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: "/v1/cast-swap",
        payload,
        headers: idempotencyHeaders(args.client_request_id),
      })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) {
        return { content: [{ type: "text" as const, text: "Cast Swap was submitted, but its job id could not be read." }], isError: true as const }
      }
      registerTask({ taskId: jobId, userId: session.userId, kind: "video" })
      return {
        content: [{ type: "text" as const, text: `Cast Swap started (job ${jobId}). To follow it, ${GET_JOB_POLL_HINT}.` }],
        structuredContent: { jobId, confirmed: true },
      }
    },
  )
}

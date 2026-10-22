/**
 * MCP `cast_swap` — the agent's face of Cast Swap: replace the people, pets,
 * products and/or the location in a short video with the user's reference
 * images, keeping its motion, framing, timing and sound.
 *
 * Price confirmation follows `render_final` / `retry_app_run`: without
 * `confirm` the tool returns the quote (`POST /v1/cast-swap/estimate` —
 * nothing is created or charged); `confirm: true`, only after the user
 * accepted it, runs (`POST /v1/cast-swap` → 202 `{ jobId }`), and the job is
 * followed with `get_job` / `wait_for_job` like any other.
 *
 * The route is the authority on every rule (role counts, the 30-image total,
 * draft only at 480p, the clip's length, the pre / post prompt's `{role:N}`
 * mentions, the preview-only role settings, face masking's ranges and its
 * min ≤ max rule); this tool maps snake_case to the route's body and leaves the rest
 * to it. The user travels in `mcpInject`'s
 * header, never the body.
 *
 * Cloud-only: registered behind `hasCredits()` in server.ts — the routes are
 * the cloud plugin's, and a cloud boot without it answers `not_available`.
 *
 * STANDING RULE: the body below is built field by field from the tool's own
 * arguments and never carries `trendRun`. Any internal relay of a
 * user-supplied body to `/v1/cast-swap` must never forward `trendRun` — only
 * the platform's trend routes compose a run that sets it.
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
  breakdown: { castSwap: number; seedance: number; references: number; masking?: number }
  /** Face masking "auto" only: charged only if the masked retry runs; not in totalCredits. */
  maskingCredits?: number
  settlesLower: boolean
}

/** `face_masking` as the tool takes it (snake_case). */
interface FaceMaskingArgs {
  mode: "off" | "always" | "auto"
  fill?: "blur" | "depth"
  min_face_height_pct?: number
  max_face_height_pct?: number
  zone?: { left_pct?: number; right_pct?: number; top_pct?: number; bottom_pct?: number }
  blur_strength_pct?: number
  threshold?: number
}

/** `face_masking` → the route's `faceMasking`, only the keys given (the route fills the defaults). */
function faceMaskingBody(fm: FaceMaskingArgs) {
  const { mode, fill, min_face_height_pct, max_face_height_pct, zone, blur_strength_pct, threshold } = fm
  return {
    mode,
    ...(fill !== undefined ? { fill } : {}),
    ...(min_face_height_pct !== undefined ? { minFaceHeightPct: min_face_height_pct } : {}),
    ...(max_face_height_pct !== undefined ? { maxFaceHeightPct: max_face_height_pct } : {}),
    ...(zone !== undefined ? { zone: zoneBody(zone) } : {}),
    ...(blur_strength_pct !== undefined ? { blurStrengthPct: blur_strength_pct } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
  }
}

function zoneBody({ left_pct, right_pct, top_pct, bottom_pct }: NonNullable<FaceMaskingArgs["zone"]>) {
  return {
    ...(left_pct !== undefined ? { leftPct: left_pct } : {}),
    ...(right_pct !== undefined ? { rightPct: right_pct } : {}),
    ...(top_pct !== undefined ? { topPct: top_pct } : {}),
    ...(bottom_pct !== undefined ? { bottomPct: bottom_pct } : {}),
  }
}

const trait = z.enum(["new", "original"]).optional()
const images = z.array(z.string().url()).max(3).nullable().optional()
/** Preview-only settings, on every role kind; a full run ignores them. Exported for the schema walk. */
export const castSwapRolePreviewArgs = {
  preview_name: z.string().trim().min(1).max(200).optional().describe("Name used instead of name in a preview."),
  in_preview: z.boolean().optional().describe("false = left out of a preview (not prepared or charged). Default true."),
}

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
        "Replace the people, pets, products and/or the place in a 4–30 s video with the user's reference images, keeping its motion, framing, timing and sound. " +
        "Each role names a subject (or the setting) in the video and takes 0–3 images of ONE subject or place; a role with none stays as in the video. " +
        "By default each person, pet and product's images are first made into one clean reference picture (extra credits, about a minute; prepare_references: false skips it). " +
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
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("pet"),
                name: z.string().min(1).describe('Which animal, e.g. "the dog".'),
                images,
                body: trait.describe("As a person's body."),
                coat: trait.describe("Fur, colors and markings; as body."),
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("product"),
                name: z.string().min(1).describe('Which object, e.g. "the can".'),
                images,
                shape: trait.describe("Shape and proportions; as a person's body."),
                finish: trait.describe("Colors, materials and markings; as shape."),
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("location"),
                name: z.string().min(1).optional().describe('Default "the setting".'),
                images,
                ...castSwapRolePreviewArgs,
              }),
            ]),
          )
          .describe("At most 6 person, 1 location, 3 pet and 3 product roles; 30 images in all. At least one role with images, or a pre_prompt or post_prompt."),
        pre_prompt: z
          .string()
          .max(4000)
          .optional()
          .describe("Instructions placed before the role instructions. Mention roles as in post_prompt."),
        post_prompt: z
          .string()
          .max(4000)
          .optional()
          .describe("Extra instructions. Mention a role as {role:N}, N 1-based over roles (empty roles count)."),
        preview: z.boolean().optional().describe("true = render 4 s from preview_start."),
        preview_start: z.number().min(0).optional().describe("Seconds, default 0; preview_start + 4 must fit the clip."),
        resolution: z.enum(["480p", "720p", "1080p"]).optional().describe('Default "480p".'),
        draft: z.boolean().optional().describe("Render as a draft, 480p only. Default true at 480p, false above."),
        prepare_references: z.boolean().optional().describe("Default true: prepare the reference pictures first."),
        face_masking: z
          .object({
            mode: z
              .enum(["off", "always", "auto"])
              .describe('Mask the faces in the clip before the video model: "off", "always", or "auto" = only on a retry after the model refuses the clip.'),
            fill: z.enum(["blur", "depth"]).optional().describe('Default "blur".'),
            min_face_height_pct: z.number().min(0).max(100).optional().describe("Mask faces at least this % of frame height. Default 15."),
            max_face_height_pct: z.number().min(0).max(100).optional().describe("And at most this %; default 0 = no limit."),
            zone: z
              .object({
                left_pct: z.number().min(0).max(49).optional(),
                right_pct: z.number().min(0).max(49).optional(),
                top_pct: z.number().min(0).max(49).optional(),
                bottom_pct: z.number().min(0).max(49).optional(),
              })
              .optional()
              .describe("Frame margins (%, default 0); a face centred in one is not masked."),
            blur_strength_pct: z.number().min(0.1).max(5).optional().describe("Blur strength, % of frame width. Default 2."),
            threshold: z.number().min(0.05).max(0.95).optional().describe("Face detection; lower finds more. Default 0.5."),
          })
          .optional()
          .describe("Default off."),
        quality: z.enum(["draft"]).optional().describe('Deprecated: use resolution + draft. "draft" means a 480p draft.'),
        session_id: z.string().min(1).optional().describe("A generation session to file the result in."),
        confirm: z.boolean().optional().describe("true ONLY after the user accepted the quoted credits in this conversation."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload = {
        videoUrl: args.video_url,
        roles: args.roles.map(({ preview_name, in_preview, ...role }) => ({
          ...role,
          images: role.images ?? null,
          ...(preview_name !== undefined ? { previewName: preview_name } : {}),
          ...(in_preview !== undefined ? { inPreview: in_preview } : {}),
        })),
        ...(args.pre_prompt !== undefined ? { prePrompt: args.pre_prompt } : {}),
        ...(args.post_prompt !== undefined ? { postPrompt: args.post_prompt } : {}),
        ...(args.preview !== undefined ? { preview: args.preview } : {}),
        ...(args.preview_start !== undefined ? { previewStart: args.preview_start } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
        ...(args.prepare_references !== undefined ? { prepareReferences: args.prepare_references } : {}),
        ...(args.face_masking !== undefined ? { faceMasking: faceMaskingBody(args.face_masking) } : {}),
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
        const references = quote.breakdown?.references
          ? ` That includes ${quote.breakdown.references} credits to prepare the reference pictures first (prepare_references: false skips it).`
          : ""
        // Worded by the mode asked for: "auto" charges masking only on a
        // retry (not in the total), "always" has it in the total.
        const maskMode = args.face_masking?.mode
        const autoMasking = quote.maskingCredits ?? quote.breakdown?.masking
        const masking =
          maskMode === "auto" && autoMasking
            ? ` Face masking adds ${autoMasking} more credits, charged only if the video model refuses the clip and the run is retried with the faces masked.`
            : maskMode === "always" && quote.breakdown?.masking
              ? ` That includes ${quote.breakdown.masking} credits to mask the faces first.`
              : ""
        const lower = quote.settlesLower
          ? " The video's length is left to the model, so the final charge is expected to come out lower than this quote."
          : ""
        return {
          content: [
            {
              type: "text" as const,
              text:
                `This Cast Swap ${args.preview ? "preview " : ""}costs about ${quote.totalCredits} credits.${references}${masking}${lower} ` +
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

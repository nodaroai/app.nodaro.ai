/**
 * MCP `cast_swap` — the agent's face of Nodaro Motion (internally Cast Swap):
 * replace the people, pets, products and/or the location in a short video
 * with the user's reference images, keeping its motion, framing, timing and
 * sound.
 *
 * Price confirmation follows `render_final` / `retry_app_run`: without
 * `confirm` the tool returns the quote (`POST /v1/cast-swap/estimate` —
 * nothing is created or charged); `confirm: true`, only after the user
 * accepted it, runs (`POST /v1/cast-swap` → 202 `{ jobId }`), and the job is
 * followed with `get_job` / `wait_for_job` like any other.
 *
 * Engines: the tool takes Nodaro Motion's public ids (`"motion-prism"`,
 * `"motion-pulse"`) and, unlisted, the ids an older client may still send (the
 * earlier public ids `"motion-pro"` / `"motion-lite"`, and the internal ones);
 * every form is sent to the route as the INTERNAL id (`castSwapEngineFrom`),
 * which every Cast Swap engine takes, and the quote — whichever id the engine
 * answers it under — names the current public one.
 *
 * Face masking is not the user's: Nodaro sets it per engine (the admin's
 * `nodaro_motion_masking`, read by the engine itself). The tool lists no
 * `face_masking` and no `kling_length`; its schema is a loose object, so an
 * older client's arguments still validate: `kling_length` is read as
 * `motion_length`, and `face_masking` is accepted, ignored and never sent.
 *
 * The route is the authority on every rule (role counts, the 30-image total,
 * draft only at 480p, each engine's resolutions and Nodaro Motion Pulse's lack
 * of a draft, the clip's length, the pre / post prompt's `{role:N}`
 * mentions, the preview-only role settings); this tool maps snake_case to
 * the route's body and leaves the rest to it. The user travels in
 * `mcpInject`'s header, never the body.
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
import {
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_STYLES,
  NODARO_MOTION_ENGINES,
  castSwapEngineFrom,
  nodaroMotionEngineName,
  nodaroMotionEngineOf,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { registerTask } from "../tasks.js"
import { isRouterNotFound } from "./_studio-helpers.js"
import { castSwapLengthKey, loadedEngineRuns } from "../../cast-swap-engines.js"
import { neutralBreakdown, privacyCreditsOf } from "../../nodaro-motion-quote.js"
import { originalCdnImageUrls } from "../../cdn-original-url.js"
import { clientRequestIdSchema, errorResult, GET_JOB_POLL_HINT, idempotencyHeaders, parseJobId } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

const NOT_AVAILABLE = "Nodaro Motion is a Nodaro Cloud feature and is not served on this deployment."

export interface RegisterCastSwapToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/** The engine's quote as it arrives (old or new key names, `nodaro-motion-quote.ts`). */
interface CastSwapQuote {
  /** Held when the run starts. */
  totalCredits: number
  /** The charge the run is expected to come to; on Nodaro Motion Pulse the hold itself; absent from an older engine. */
  expectedCredits?: number
  breakdown?: unknown
  /** The engine, in any vocabulary (absent from an older engine = Nodaro Motion Prism); answered as the current public id. */
  engine?: string
  settlesLower: boolean
}

/**
 * `engine` as the tool takes it: a public id, or (still accepted from an older
 * client, never listed) an earlier public id or an internal one, read as the
 * public id it names.
 */
export const castSwapEngineArg = z.preprocess(
  (v) => {
    const engine = castSwapEngineFrom(v)
    return engine ? nodaroMotionEngineOf(engine) : v
  },
  z.enum(NODARO_MOTION_ENGINES),
)

/** A Nodaro Motion Pulse run's length fits. */
const LENGTHS = ["cut-end", "cut-start"] as const

const trait = z.enum(["new", "original"]).optional()
const images = z.array(z.string().url()).max(3).nullable().optional()
/** A fixed reference exactly as the route parses it: http(s) images of at most 4096 characters, a trimmed non-empty line. */
const reference = z.object({
  images: z.array(z.url({ protocol: /^https?$/ }).max(4096)).min(1).max(3),
  line: z.string().trim().min(1).max(500),
})
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
      title: "Nodaro Motion",
      description:
        "Nodaro Motion: replace the people, pets, products and/or the place in a 4–30 s video with the user's reference images, keeping its motion, framing, timing and sound. " +
        "Each role names a subject (or the setting) in the video and takes 0–3 images of ONE subject or place; a role with none stays as in the video. " +
        "By default each person, pet and product's images are first made into one clean reference picture (extra credits, about a minute; prepare_references: false skips it). " +
        "Without `confirm` it returns the PRICE QUOTE only (nothing is charged): show the credits to the user, and call again with `confirm: true` only once they accept. " +
        "That returns a job id: poll it with wait_for_job. `preview: true` renders 4 s first, a cheaper check of the look. " +
        'engine picks the engine: "motion-prism" (Nodaro Motion Prism, the default; 480p draft, 720p, 1080p) or "motion-pulse" (Nodaro Motion Pulse; 720p default or 1080p, no draft). ' +
        "Image and video URLs must be http(s): upload local files with the upload tools first.",
      // A LOOSE object: an argument the tool no longer lists still reaches the handler, which
      // takes an older client's `kling_length` as `motion_length` and ignores `face_masking`
      // (the payload is built field by field). Only the listed keys are in the tool list.
      inputSchema: z.looseObject({
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
          .describe("At most 6 person, 1 location, 3 pet and 3 product roles; 30 images in all. At least one role with images, a reference, or a pre_prompt or post_prompt."),
        references: z
          .array(reference)
          .max(5)
          .optional()
          .describe('Fixed references no role replaces: 1–3 images of ONE thing each, and the line naming it, e.g. "the glass she drinks from" ({image} = its first image). Their images count toward the 30.'),
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
        engine: castSwapEngineArg
          .optional()
          .describe('Default "motion-prism" (Nodaro Motion Prism). "motion-pulse" (Nodaro Motion Pulse): 720p or 1080p only, no draft; its Full Quality is a new take.'),
        style: z
          .enum(CAST_SWAP_STYLES)
          .optional()
          .describe('"precise" (default) follows the clip exactly; "motion" follows the clip\'s movement and takes the looks from the photos, more freely than precise. Its price may differ: the quote shows it.'),
        motion_length: z
          .enum(LENGTHS)
          .optional()
          .describe('motion-pulse only: cut the clip to whole seconds at its end (default) or start.'),
        resolution: z.enum(["480p", "720p", "1080p"]).optional().describe('Default "480p" (motion-pulse: "720p"; no 480p).'),
        draft: z.boolean().optional().describe("Render as a draft, 480p motion-prism only. Default true at 480p, false above."),
        prepare_references: z.boolean().optional().describe("Default true: prepare the reference pictures first."),
        quality: z.enum(["draft"]).optional().describe('Deprecated: use resolution + draft. "draft" means a 480p draft.'),
        session_id: z.string().min(1).optional().describe("A generation session to file the result in."),
        confirm: z.boolean().optional().describe("true ONLY after the user accepted the quoted credits in this conversation."),
        client_request_id: clientRequestIdSchema.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      // The internal id: what every Cast Swap engine takes on the wire (an older one knows no other).
      const engine = args.engine !== undefined ? castSwapEngineFrom(args.engine) : undefined
      // An engine that predates the choice drops an `engine` it does not know and runs Prism:
      // never send it a body that names another engine (quote or run).
      if (engine !== undefined && !loadedEngineRuns(engine)) {
        return errorResult(
          503,
          JSON.stringify({
            error: { code: "engine_unavailable", message: `${nodaroMotionEngineName(engine)} is not available on this deployment yet.` },
          }),
        )
      }
      // An older client's `kling_length` (not listed; checked as `motion_length` is).
      const legacyLength = (args as Record<string, unknown>).kling_length
      if (args.motion_length === undefined && legacyLength !== undefined && !LENGTHS.includes(legacyLength as never)) {
        return errorResult(400, JSON.stringify({ error: { code: "validation_error", message: 'motion_length must be "cut-end" or "cut-start".' } }))
      }
      const length = args.motion_length ?? (legacyLength as (typeof LENGTHS)[number] | undefined)
      const payload = {
        videoUrl: args.video_url,
        roles: args.roles.map(({ preview_name, in_preview, ...role }) => ({
          ...role,
          // The original files, never a CDN display rendition (lib/cdn-original-url.ts).
          images: role.images ? originalCdnImageUrls(role.images) : null,
          ...(preview_name !== undefined ? { previewName: preview_name } : {}),
          ...(in_preview !== undefined ? { inPreview: in_preview } : {}),
        })),
        ...(args.references !== undefined
          ? { references: args.references.map((r) => ({ ...r, images: originalCdnImageUrls(r.images) })) }
          : {}),
        ...(args.pre_prompt !== undefined ? { prePrompt: args.pre_prompt } : {}),
        ...(args.post_prompt !== undefined ? { postPrompt: args.post_prompt } : {}),
        ...(args.preview !== undefined ? { preview: args.preview } : {}),
        ...(args.preview_start !== undefined ? { previewStart: args.preview_start } : {}),
        ...(engine !== undefined ? { engine } : {}),
        ...(args.style !== undefined ? { style: args.style } : {}),
        // Under the key this environment's engine takes (`motionLength`, else the old `klingLength`).
        ...(length !== undefined ? { [castSwapLengthKey()]: length } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
        ...(args.prepare_references !== undefined ? { prepareReferences: args.prepare_references } : {}),
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
          return { content: [{ type: "text" as const, text: "The Nodaro Motion quote could not be read." }], isError: true as const }
        }
        // The neutral key names only (an engine before 0.395.0 also, or only, sends the old ones).
        const breakdown = neutralBreakdown(quote.breakdown)
        const privacyCredits = privacyCreditsOf(quote)
        const references = breakdown.references
          ? ` That includes ${breakdown.references} credits to prepare the reference pictures first (prepare_references: false skips it).`
          : ""
        // Nodaro sets how the clip is prepared, per engine. A setting that retries a refused clip
        // quotes that retry apart (`privacyCredits`, in neither total); one that always prepares it
        // has it in the totals already, so there is nothing more to say.
        const retry =
          privacyCredits !== undefined && privacyCredits > 0
            ? ` If the video model refuses the clip, the run is retried once, for ${privacyCredits} more credits charged only then.`
            : ""
        // The quote's engine: absent from an older engine, which runs Nodaro Motion Prism.
        const quotedEngine = castSwapEngineFrom(quote.engine) ?? CAST_SWAP_ENGINE_WHEN_OMITTED
        const publicEngine: NodaroMotionEngine = nodaroMotionEngineOf(quotedEngine)
        const engineName = nodaroMotionEngineName(quotedEngine)
        // The expected charge first, with the hold beside it (as estimate_trend words it);
        // an older engine answers only the hold, which settles lower.
        const expected = typeof quote.expectedCredits === "number" ? quote.expectedCredits : null
        const held = expected !== null && expected !== quote.totalCredits ? ` (up to ${quote.totalCredits} held while it runs)` : ""
        const lower =
          expected === null && quote.settlesLower
            ? " The video's length is left to the model, so the final charge is expected to come out lower than this quote."
            : ""
        return {
          content: [
            {
              type: "text" as const,
              text:
                `This ${engineName} ${args.preview ? "preview " : "run "}costs about ${expected ?? quote.totalCredits} credits${held}.${references}${retry}${lower} ` +
                "Present this to the user; call cast_swap again with the same arguments and confirm: true once they accept.",
            },
          ],
          // Built field by field: the engine's old key names never reach the agent.
          structuredContent: {
            engine: publicEngine,
            engineName,
            totalCredits: quote.totalCredits,
            ...(expected !== null ? { expectedCredits: expected } : {}),
            breakdown,
            ...(privacyCredits !== undefined ? { privacyCredits } : {}),
            settlesLower: quote.settlesLower === true,
            confirmed: false,
          },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: "/v1/cast-swap",
        payload,
        headers: idempotencyHeaders(args.client_request_id),
        // The session reaches the job through the server-side scope (the
        // route ignores a relayed body's `sessionId`).
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) {
        return { content: [{ type: "text" as const, text: "Nodaro Motion was submitted, but its job id could not be read." }], isError: true as const }
      }
      registerTask({ taskId: jobId, userId: session.userId, kind: "video" })
      return {
        content: [{ type: "text" as const, text: `Nodaro Motion started (job ${jobId}). To follow it, ${GET_JOB_POLL_HINT}.` }],
        structuredContent: { jobId, confirmed: true },
      }
    },
  )
}

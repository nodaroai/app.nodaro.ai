/**
 * MCP `video_remake` — the agent's face of Video Remake (internally Cast Swap):
 * replace the people, pets, products and/or the location in a short video
 * with the user's reference images, keeping its motion, framing, timing and
 * sound.
 *
 * Price confirmation follows `render_final` / `retry_app_run`: without
 * `confirm` the tool returns the quote (`POST /v1/video-remake/estimate` —
 * nothing is created or charged); `confirm: true`, only after the user
 * accepted it, runs (`POST /v1/video-remake` → 202 `{ jobId }`), and the job is
 * followed with `get_job` / `wait_for_job` like any other.
 *
 * Engines: the tool takes Video Remake's public ids (`"nodaro-prism"`,
 * `"nodaro-pulse"`) and, unlisted, the ids an older client may still send (the
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
 * draft only at 480p and only with `draft: true` (480p is plain by default),
 * each engine's resolutions and Nodaro Pulse's lack of a draft (and so
 * of Full Quality), the clip's length, the pre / post prompt's `{role:N}`
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
 * `art_style` becomes `direction.style`, the only `direction` key it sends; a
 * `direction` argument of the caller's own is refused (`use_art_style`).
 *
 * A custom style (`custom_style`, `custom_style_image_url`) is the style in
 * the caller's own words, sent as `direction.customStyle` in place of
 * `direction.style` (never with `art_style`: `custom_style_with_art_style`).
 * With an image, the tool has the engine put the image's style into words
 * (`POST /v1/video-remake/describe-style`, with `custom_style` as its note)
 * and runs with that text — inside the one confirmed call, before anything is
 * held; a describe refusal is the tool's answer and nothing runs. The QUOTE
 * never reads the image: it is sent the caller's text, else a neutral
 * placeholder, since the price does not depend on the style's words. An
 * engine that does not declare custom styles is sent neither
 * (`custom_style_unavailable`). A confirmed run whose image was read says
 * the words it was read as (`custom_style_text`, for information only), as
 * the job recorded them. A note's limit is the engine's own (`noteMaxChars`
 * of its custom-style route), never a figure kept here.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { DIRECTION_ID_MAX_CHARS } from "@nodaro/prompts/prompt-builder"
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
import { refusalResult, resolveToolOffer } from "../tool-offer.js"
import { hasCredits } from "../../config.js"
import { RECAST_POINTER, recastOffered } from "./_video-lanes.js"
import { registerTask } from "../tasks.js"
import { isRouterNotFound } from "./_studio-helpers.js"
import { castSwapLengthKey, loadedEngineRuns, loadedEngineTakesArtStyle, loadedEngineTakesCustomStyle } from "../../cast-swap-engines.js"
import { neutralBreakdown, privacyCreditsOf } from "../../nodaro-motion-quote.js"
import { originalCdnImageUrls } from "../../cdn-original-url.js"
import { clientRequestIdSchema, errorResult, GET_JOB_POLL_HINT, idempotencyHeaders, parseJobId } from "./_verb-helpers.js"
import { amountsNote, amountWord, statedAmount, statedAmountRecord, unitFields } from "../amounts.js"
import { statedName } from "../deployment-name.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

/** Where a quote's text turns from the price to what to do next. */
const QUOTE_NEXT = "Present this to the user; "

const NOT_AVAILABLE = "Video Remake is a Nodaro Cloud feature and is not served on this deployment."

export interface RegisterCastSwapToolsOpts {
  server: Pick<McpServer, "registerTool">
  session: McpSession
  fastify: FastifyInstance
  /** Set by `videoRemakeQuote` only: the quote is asked for through another tool. */
  quoteFor?: VideoRemakeQuoteFor
}

/**
 * A quote asked for through another tool (`modify_video`, for a call that names one of the
 * engines): how its last sentence says to run it.
 */
export interface VideoRemakeQuoteFor {
  next: string
}

/** The arguments of the `video_remake` call another tool quotes: a clip and an instruction, no role. */
export interface VideoRemakeInstructionRun {
  video_url: string
  roles: []
  post_prompt: string
  engine: NodaroMotionEngine
  resolution?: "480p" | "720p" | "1080p"
  draft?: boolean
}

/**
 * The refusal of a call that asks for a Video Remake engine through another tool where
 * `video_remake` is not offered, judged when the call is made (as a call to the tool itself is):
 * `not_available` off Nodaro Cloud, else the offer's own refusal. Undefined where it is offered.
 */
export async function videoRemakeRefusal(session: McpSession) {
  if (!hasCredits()) return errorResult(404, JSON.stringify({ error: { code: "not_available", message: NOT_AVAILABLE } }))
  const withheld = (await resolveToolOffer(session.userId))?.refusalOf("video_remake")
  return withheld ? refusalResult(withheld) : undefined
}

/**
 * The quote `video_remake` gives for `run`, asked for through another tool. It IS a `video_remake`
 * call: the tool's own handler, registered for this session on a stand-in that only keeps it, is
 * called with `run` and no `confirm`, so the refusals, the estimate and every figure are the tool's.
 * Nothing is started: only a `video_remake` call with `confirm: true` runs.
 *
 * The answer's structured content is ONE key, `videoRemake`: `quote`, the tool's quote as it gives
 * it, `arguments`, the `video_remake` call that runs it, and `summary`, the quote's price sentence
 * (what the asking tool's card shows). One key, since the asking tool's output schema is closed
 * and lists it.
 *
 * The handler is reached through a stand-in registration so that this file keeps its layout while
 * other changes to it are in flight; a plain exported function that the tool and this both call is
 * the cleaner form once those have landed.
 */
export async function videoRemakeQuote(opts: Pick<RegisterCastSwapToolsOpts, "session" | "fastify">, run: VideoRemakeInstructionRun, quoteFor: VideoRemakeQuoteFor) {
  type Answer = { content: { type: "text"; text: string }[]; isError?: true; structuredContent?: Record<string, unknown> }
  let handler: ((args: VideoRemakeInstructionRun) => Promise<Answer>) | undefined
  const server = {
    registerTool: (name: string, _config: unknown, cb: unknown) => {
      if (name === "video_remake") handler = cb as typeof handler
    },
  } as unknown as Pick<McpServer, "registerTool">
  registerCastSwapTools({ ...opts, server, quoteFor })
  // Not registered: the session may not run it (the tool's own scope gate).
  if (!handler) return errorResult(403, JSON.stringify({ error: { code: "forbidden", message: "This session may not run Video Remake." } }))
  const answer = await handler(run)
  if (answer.isError || !answer.structuredContent) return answer
  // The price sentence: the quote's text up to where it says what to do next.
  const summary = (answer.content[0]?.text ?? "").split(QUOTE_NEXT)[0]!.trim()
  return { ...answer, structuredContent: { videoRemake: { quote: answer.structuredContent, arguments: run, summary } } }
}

/** The engine's quote as it arrives (old or new key names, `nodaro-motion-quote.ts`). */
interface CastSwapQuote {
  /** Held when the run starts. */
  totalCredits: number
  /** The charge the run is expected to come to; on Nodaro Pulse the hold itself; absent from an older engine. */
  expectedCredits?: number
  breakdown?: unknown
  /** The engine, in any vocabulary (absent from an older engine = Nodaro Prism); answered as the current public id. */
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

/** The longest custom style a run takes, in characters (the engine's own limit; the route refuses past it). */
export const CUSTOM_STYLE_MAX_CHARS = 600

/**
 * The longest note the describe step takes with an image when the engine does
 * not say (a custom style's own limit). The engine's own figure is read from
 * it ({@link customStyleNoteMaxChars}); this is never a limit kept here.
 */
export const CUSTOM_STYLE_NOTE_MAX_CHARS_FALLBACK = CUSTOM_STYLE_MAX_CHARS

/** The loaded engine's note limit, once it answered one: a fact of the engine this process loaded. */
let engineNoteMaxChars: number | undefined

/** Test hook: forget the engine's note limit. */
export function _resetCustomStyleNoteLimitForTests(): void {
  engineNoteMaxChars = undefined
}

/**
 * The longest note the loaded engine's describe step takes: its own answer
 * (`noteMaxChars` of its custom-style route, the platform's own read), kept
 * for the process once read; {@link CUSTOM_STYLE_NOTE_MAX_CHARS_FALLBACK}
 * whenever it cannot be read (asked again next time).
 */
async function customStyleNoteMaxChars(fastify: FastifyInstance, session: McpSession): Promise<number> {
  if (engineNoteMaxChars !== undefined) return engineNoteMaxChars
  try {
    const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/video-remake/custom-style", payload: {} })
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const parsed = JSON.parse(res.body) as { data?: { noteMaxChars?: unknown }; noteMaxChars?: unknown }
      const max = parsed.data?.noteMaxChars ?? parsed.noteMaxChars
      if (typeof max === "number" && Number.isInteger(max) && max > 0) {
        engineNoteMaxChars = max
        return max
      }
    }
  } catch {
    // The fallback below.
  }
  return CUSTOM_STYLE_NOTE_MAX_CHARS_FALLBACK
}

/** The custom style a job recorded (`input_data.direction.customStyle`), read as its owner; undefined when it cannot be read. */
async function recordedCustomStyle(fastify: FastifyInstance, session: McpSession, jobId: string): Promise<string | undefined> {
  try {
    const res = await mcpInject(fastify, session, { method: "GET", url: `/v1/jobs/${encodeURIComponent(jobId)}` })
    if (res.statusCode >= 400) return undefined
    const parsed = JSON.parse(res.body) as { data?: { input_data?: { direction?: { customStyle?: unknown } } } }
    const text = parsed.data?.input_data?.direction?.customStyle
    return typeof text === "string" && text.trim() !== "" ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * What a QUOTE is sent as the custom style when the caller gave an image and
 * no text: the image is read only once the run is confirmed, and the price
 * does not depend on the style's words. Plain words, no curly braces.
 */
export const CUSTOM_STYLE_QUOTE_PLACEHOLDER = "A custom visual style taken from a reference image."

/** A Nodaro Pulse run's length fits. */
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

export function registerCastSwapTools({ server, session, fastify, quoteFor }: RegisterCastSwapToolsOpts): void {
  if (!passesGate(session, executeGate)) return
  // What the deployment offers decides whether its tools are listed (lib/mcp/tool-needs.ts).

  server.registerTool(
    "video_remake",
    {
      title: "Video Remake",
      description:
        "Video Remake: the way to edit, modify, restyle or remake a video (a 4–30 s clip). " +
        "It keeps the clip's motion, camera, timing and sound and changes what you ask: the cast, a prop, the place, the look or the art style. " +
        "A prompt alone is enough (`post_prompt`, with `roles: []`); to replace people, pets, products and/or the place, give each role the user's reference images. " +
        "Also the way to do motion transfer / motion control: it keeps a clip's motion and puts your own cast into it (give each role images of who or what takes its place). " +
        "Each role names a subject (or the setting) in the video and takes 0–3 images of ONE subject or place; a role with none stays as in the video. " +
        "By default each person, pet and product's images are first made into one clean reference picture (extra credits, about a minute; prepare_references: false skips it). " +
        "Without `confirm` it returns the PRICE QUOTE only (nothing is charged): show the credits to the user, and call again with `confirm: true` only once they accept. " +
        "That returns a job id: poll it with wait_for_job. `preview: true` renders 4 s first, a cheaper check of the look. " +
        'engine picks the engine: "nodaro-prism" (Nodaro Prism, the default; 480p, 720p, 1080p) or "nodaro-pulse" (Nodaro Pulse; 720p default or 1080p, no draft). ' +
        "Image and video URLs must be http(s): upload local files with the upload tools first." +
        (recastOffered(session) ? ` ${RECAST_POINTER}` : "") +
        amountsNote(),
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
                name: z.string().max(200).optional().describe('Who in the video, e.g. "the woman that attacks". Unset: named by its first image (needs one).'),
                images,
                body: trait.describe('"new" (default) from the images, or "original" from the video.'),
                outfit: trait.describe("As body."),
                hair: trait.describe("Hairstyle and haircut; as body."),
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("pet"),
                name: z.string().max(200).optional().describe('Which animal, e.g. "the dog". Unset: named by its first image (needs one).'),
                images,
                body: trait.describe("As a person's body."),
                coat: trait.describe("Fur, colors and markings; as body."),
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("product"),
                name: z.string().max(200).optional().describe('Which object, e.g. "the can". Unset: named by its first image (needs one).'),
                images,
                shape: trait.describe("Shape and proportions; as a person's body."),
                finish: trait.describe("Colors, materials and markings; as shape."),
                ...castSwapRolePreviewArgs,
              }),
              z.object({
                kind: z.literal("location"),
                name: z.string().max(200).optional().describe('Default "the setting".'),
                images,
                ...castSwapRolePreviewArgs,
              }),
            ]),
          )
          .describe("At most 6 person, 1 location, 3 pet and 3 product roles; 30 images in all. At least one role with images, a reference, a pre_prompt or post_prompt — or, on a nodaro-prism Flex run where the engine takes style-only runs, an art_style alone (restyles the whole clip)."),
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
          .describe('Default "nodaro-prism" (Nodaro Prism). "nodaro-pulse" (Nodaro Pulse): 720p or 1080p only, no draft, no Full Quality.'),
        style: z
          .enum(CAST_SWAP_STYLES)
          .optional()
          .describe('"precise" (default) follows the clip exactly; "motion" follows the clip\'s movement and takes the looks from the photos, more freely than precise. Its price may differ: the quote shows it. An admin may force "motion" for the engine, which overrides this.'),
        art_style: z
          .string()
          .min(1)
          .max(DIRECTION_ID_MAX_CHARS)
          .optional()
          .describe('An art style on Nodaro Prism (Flex; a Precise call may run as Flex): a "style" picker catalog id (get_picker_catalog "style"), e.g. "pop-art". The prompt takes its video wording. With no role images and no references it restyles the whole clip, where the engine takes style-only runs (Flex). Pulse takes none.'),
        custom_style: z
          .string()
          .max(CUSTOM_STYLE_MAX_CHARS)
          .optional()
          .describe("The style in your own words, instead of art_style (never both). Write it yourself: describe the visual style only — the medium (drawn, 3D-rendered or filmed), line, colour, lighting and texture — never who or what is in the video, and no names of people. At most 600 characters. Nodaro Prism only."),
        custom_style_image_url: z
          .url({ protocol: /^https$/ })
          .max(4096)
          .optional()
          .describe("A public https image whose visual style the video should take. Nodaro reads the image's style (never its content) and restyles the clip in it. With custom_style too, your text is a note on the image's style (for example 'like this, but darker'). Not with art_style."),
        motion_length: z
          .enum(LENGTHS)
          .optional()
          .describe('nodaro-pulse only: cut the clip to whole seconds at its end (default) or start.'),
        resolution: z.enum(["480p", "720p", "1080p"]).optional().describe('Default "480p" (nodaro-pulse: "720p"; no 480p).'),
        draft: z.boolean().optional().describe("true = a 480p draft (nodaro-prism only) that full_quality can finish at 1080p. Default false: plain."),
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
      // `direction` is the REST field, not this tool's: the loose schema lets it through, and dropping it
      // would charge for a run without the style asked for. Refused, pointing at `art_style`.
      if ((args as Record<string, unknown>).direction !== undefined) {
        return errorResult(
          400,
          JSON.stringify({
            error: {
              code: "use_art_style",
              message: 'video_remake takes no direction. Give an art style as art_style instead, a "style" picker catalog id (get_picker_catalog "style").',
            },
          }),
        )
      }
      // An engine that does not declare art styles strips a `direction` it does not know and runs without
      // the style: never send it a body that names one (quote or run). Said directly, since `errorResult`
      // words every 503 as a model outage.
      if (args.art_style !== undefined && !loadedEngineTakesArtStyle()) {
        return {
          content: [{ type: "text" as const, text: "Nodaro: art styles are not available on this deployment yet. [art_style_unavailable]" }],
          isError: true as const,
        }
      }
      // A custom style: the caller's own words, an image whose style the engine puts into words, or both
      // (the words then a note on the image's style). One style a run: never beside a catalog art style.
      const customText = args.custom_style
      const customImage = args.custom_style_image_url
      const customStyleAsked = customText !== undefined || customImage !== undefined
      if (customStyleAsked && args.art_style !== undefined) {
        return errorResult(
          400,
          JSON.stringify({
            error: {
              code: "custom_style_with_art_style",
              message: "Give an art style (art_style) or a custom style (custom_style, custom_style_image_url), not both.",
            },
          }),
        )
      }
      // An engine that does not declare custom styles refuses a `direction.customStyle` it does not know and
      // has no route that reads an image: never send it either (quote or run). Said directly, as for art_style.
      if (customStyleAsked && !loadedEngineTakesCustomStyle()) {
        return {
          content: [{ type: "text" as const, text: "Nodaro: custom styles are not available on this deployment yet. [custom_style_unavailable]" }],
          isError: true as const,
        }
      }
      // With an image the text is a note for the step that reads it, whose limit is the engine's own: one past it
      // is refused on the quote already, so it never first shows once the run is confirmed.
      const customNote = customImage !== undefined && customText !== undefined && customText.trim() !== "" ? customText : undefined
      const noteMaxChars = customNote !== undefined ? await customStyleNoteMaxChars(fastify, session) : undefined
      if (customNote !== undefined && noteMaxChars !== undefined && customNote.length > noteMaxChars) {
        return errorResult(
          400,
          JSON.stringify({
            error: {
              code: "custom_style_note_too_long",
              message: `With custom_style_image_url, custom_style is a note on the image's style of at most ${noteMaxChars} characters.`,
            },
          }),
        )
      }
      // An older client's `kling_length` (not listed; checked as `motion_length` is).
      const legacyLength = (args as Record<string, unknown>).kling_length
      if (args.motion_length === undefined && legacyLength !== undefined && !LENGTHS.includes(legacyLength as never)) {
        return errorResult(400, JSON.stringify({ error: { code: "validation_error", message: 'motion_length must be "cut-end" or "cut-start".' } }))
      }
      const length = args.motion_length ?? (legacyLength as (typeof LENGTHS)[number] | undefined)
      const body = {
        videoUrl: args.video_url,
        roles: args.roles.map(({ preview_name, in_preview, ...role }) => ({
          // A location left blank takes its default name ("the setting"); an unnamed person, pet or product is
          // sent as it is (the engine names it by its first image).
          ...(role.kind === "location" && typeof role.name === "string" && role.name.trim() === "" ? (({ name: _blank, ...rest }) => rest)(role) : role),
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
        // The art style's id alone, never another `direction` key; when one applies is the route's to say.
        ...(args.art_style !== undefined ? { direction: { style: args.art_style } } : {}),
        // The caller's own words, as written (the route says what they may be). With an image, the quote's
        // text and the run's are set below.
        ...(customImage === undefined && customText !== undefined ? { direction: { customStyle: customText } } : {}),
        // Under the key this environment's engine takes (`motionLength`, else the old `klingLength`).
        ...(length !== undefined ? { [castSwapLengthKey()]: length } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.draft !== undefined ? { draft: args.draft } : {}),
        ...(args.prepare_references !== undefined ? { prepareReferences: args.prepare_references } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      }

      if (args.confirm !== true) {
        // A quote never reads the image: it is sent the caller's note, else a neutral placeholder. Sound,
        // because the price does not depend on the style's words; the image is read once the run is confirmed.
        const payload = customImage !== undefined ? { ...body, direction: { customStyle: customNote ?? CUSTOM_STYLE_QUOTE_PLACEHOLDER } } : body
        const est = await mcpInject(fastify, session, { method: "POST", url: "/v1/video-remake/estimate", payload })
        if (est.statusCode >= 400) return refusal(est.statusCode, est.body)
        let quote: CastSwapQuote
        try {
          const parsed = JSON.parse(est.body) as { data?: CastSwapQuote } & CastSwapQuote
          quote = parsed.data ?? parsed
        } catch {
          return { content: [{ type: "text" as const, text: "The Video Remake quote could not be read." }], isError: true as const }
        }
        // The neutral key names only (an engine before 0.395.0 also, or only, sends the old ones).
        const breakdown = neutralBreakdown(quote.breakdown)
        const privacyCredits = privacyCreditsOf(quote)
        const references = breakdown.references
          ? ` That includes ${statedAmount(breakdown.references)} ${amountWord()} to prepare the reference pictures first (prepare_references: false skips it).`
          : ""
        // Nodaro sets how the clip is prepared, per engine. A setting that retries a refused clip
        // quotes that retry apart (`privacyCredits`, in neither total); one that always prepares it
        // has it in the totals already, so there is nothing more to say.
        const retry =
          privacyCredits !== undefined && privacyCredits > 0
            ? ` If the video model refuses the clip, the run is retried once, for ${statedAmount(privacyCredits)} more ${amountWord()} charged only then.`
            : ""
        // The quote's engine: absent from an older engine, which runs Nodaro Prism.
        const quotedEngine = castSwapEngineFrom(quote.engine) ?? CAST_SWAP_ENGINE_WHEN_OMITTED
        const publicEngine: NodaroMotionEngine = nodaroMotionEngineOf(quotedEngine)
        // The engine's name, the same on every deployment (deployment-name.ts keeps it).
        const engineName = statedName(nodaroMotionEngineName(quotedEngine))
        // The expected charge first, with the hold beside it (as estimate_trend words it);
        // an older engine answers only the hold, which settles lower.
        const expected = typeof quote.expectedCredits === "number" ? quote.expectedCredits : null
        const held = expected !== null && expected !== quote.totalCredits ? ` (up to ${statedAmount(quote.totalCredits)} held while it runs)` : ""
        const lower =
          expected === null && quote.settlesLower
            ? " The video's length is left to the model, so the final charge is expected to come out lower than this quote."
            : ""
        const imageStyle = customImage !== undefined ? " The image's style is read when the run is confirmed; the price does not depend on it." : ""
        return {
          content: [
            {
              type: "text" as const,
              text:
                `This ${engineName} ${args.preview ? "preview " : "run "}costs about ${statedAmount(expected ?? quote.totalCredits)} ${amountWord()}${held}.${references}${retry}${lower}${imageStyle} ` +
                `${QUOTE_NEXT}${quoteFor?.next ?? "call video_remake again with the same arguments and confirm: true once they accept."}`,
            },
          ],
          // Built field by field: the engine's old key names never reach the agent.
          structuredContent: {
            engine: publicEngine,
            engineName,
            // Every figure in the deployment's unit when it has one (lib/mcp/amounts.ts).
            totalCredits: statedAmount(quote.totalCredits),
            ...(expected !== null ? { expectedCredits: statedAmount(expected) } : {}),
            breakdown: statedAmountRecord(breakdown),
            ...(privacyCredits !== undefined ? { privacyCredits: statedAmount(privacyCredits) } : {}),
            settlesLower: quote.settlesLower === true,
            confirmed: false,
            ...unitFields(),
          },
        }
      }

      // The confirmed run with an image: its style is put into words first (no job, no charge), and a refusal
      // there is the tool's answer — nothing is held or started.
      let payload: typeof body & { direction?: { style: string } | { customStyle: string } } = body
      let describedText: string | undefined
      if (customImage !== undefined) {
        const described = await mcpInject(fastify, session, {
          method: "POST",
          url: "/v1/video-remake/describe-style",
          payload: { imageUrl: customImage, ...(customNote !== undefined ? { note: customNote } : {}) },
        })
        if (described.statusCode >= 400) return refusal(described.statusCode, described.body)
        let text: unknown
        try {
          const parsed = JSON.parse(described.body) as { data?: { text?: unknown }; text?: unknown }
          text = parsed.data?.text ?? parsed.text
        } catch {
          text = undefined
        }
        if (typeof text !== "string" || text.trim() === "") {
          return { content: [{ type: "text" as const, text: "The image's style could not be read. Nothing was started or charged." }], isError: true as const }
        }
        describedText = text
        payload = { ...body, direction: { customStyle: text } }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: "/v1/video-remake",
        payload,
        headers: idempotencyHeaders(args.client_request_id),
        // The session reaches the job through the server-side scope (the
        // route ignores a relayed body's `sessionId`).
        ...(args.session_id !== undefined ? { sessionId: args.session_id } : {}),
      })
      if (res.statusCode >= 400) return refusal(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) {
        return { content: [{ type: "text" as const, text: "Video Remake was submitted, but its job id could not be read." }], isError: true as const }
      }
      registerTask({ taskId: jobId, userId: session.userId, kind: "video" })
      // A style image was read: the words it was read as, for information only (nothing waits on them). Read
      // from the job itself, so a repeat of a call that answers an earlier job names that job's style, not the
      // words this call just read; where the job cannot be read, the words this call read.
      const styleText = describedText !== undefined ? ((await recordedCustomStyle(fastify, session, jobId)) ?? describedText) : undefined
      const styleSentence = styleText !== undefined ? ` The image's style was read as: "${styleText}"` : ""
      return {
        content: [{ type: "text" as const, text: statedName(`Video Remake started (job ${jobId}). To follow it, ${GET_JOB_POLL_HINT}.`) + styleSentence }],
        structuredContent: { jobId, confirmed: true, ...(styleText !== undefined ? { custom_style_text: styleText } : {}) },
      }
    },
  )
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requestBillingContext } from "../../billing-context.js"
import { supabase } from "../../supabase.js"
import { mcpInject } from "../internal-request.js"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { entityOwnerFilter } from "./_entity-scope.js"
import { resolveAssetId } from "../asset-resolver.js"
import { UGC_SPENT_JOB_IDS_MAX } from "./_ugc-limits.js"
import { internalHeaders, isRouterNotFound, textResult } from "./_studio-helpers.js"
import { errorResult, jobResultWithWidget, parseJobId } from "./_verb-helpers.js"

/**
 * UGC video builders — `build_ugc_creator`, `build_ugc_clips`, `build_ugc_cards`.
 *
 * Thin proxies to the Nodaro Cloud plugin's `/v1/ugc/*` builder routes. They
 * generate nothing and charge nothing: each answer hands back ready-to-run
 * calls for the public generation tools. The plugin owns the semantics; this
 * file adds only what needs the platform's own data — a saved Character's
 * images, a clear refusal for a sampled creator with no gender or category,
 * and the credit quote on a valid `build_ugc_clips` answer.
 *
 * Cloud-only: registered inside `hasCredits()` in server.ts. The routes are
 * the plugin's, so a cloud boot without it answers every call `not_available`.
 * No `outputSchema` on any tool: the answers are the plugin's to shape.
 */

export const UGC_TOOL_NAMES = ["build_ugc_creator", "build_ugc_clips", "build_ugc_cards", "ugc_split_speech", "ugc_finish_clips"] as const

const UGC_NOT_AVAILABLE = "UGC videos are a Nodaro Cloud feature and are not served on this deployment."

/** A saved Character is the caller's saved asset: the gate `get_character` sits behind. */
const characterGate: ToolGate = { required: ["assets:read"] }
const CHARACTER_SCOPE_REFUSAL =
  "Using a saved Character needs read access to your saved assets on this connection. " +
  "Reconnect with that permission, or use a sampled creator or a photo."

/** The builder route's own cap on a Character's description. */
const DESCRIPTION_MAX = 2000

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

/** The route's own `{ error: { code, message, issues } }`, when it sent one. */
function routeError(body: string): { code?: string; message?: string; issues?: unknown } | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return parsed.error && typeof parsed.error === "object" ? (parsed.error as ReturnType<typeof routeError>) : null
  } catch {
    return null
  }
}

/** How many forwarded issues a refusal lists before it summarises the rest. */
const MAX_ISSUE_LINES = 20

/** The well-formed `{ path, message }` entries of a 400's issues; anything else is dropped. */
function wellFormedIssues(issues: unknown): Array<{ path: string; message: string }> {
  if (!Array.isArray(issues)) return []
  return issues.filter(
    (i): i is { path: string; message: string } =>
      !!i && typeof i === "object" && typeof (i as { path?: unknown }).path === "string" && typeof (i as { message?: unknown }).message === "string",
  )
}

/**
 * A builder refusal, as a tool error. A router 404 — the plugin is not served
 * here — is `not_available`. A plan-shape 400 keeps every well-formed issue
 * (the first 20, then a count of the rest), so the rewrite loop can fix them in
 * one round; a 400 with none goes to the shared renderer. `minor_age_refused`
 * passes through verbatim. Everything else goes through the shared renderer.
 */
function ugcError(statusCode: number, body: string) {
  if (isRouterNotFound(statusCode, body)) {
    return errorResult(404, JSON.stringify({ error: { code: "not_available", message: UGC_NOT_AVAILABLE } }))
  }
  const error = routeError(body)
  if (statusCode === 422 && error?.code === "minor_age_refused") return refuse(body)
  const issues = statusCode === 400 ? wellFormedIssues(error?.issues) : []
  if (issues.length > 0) {
    const lines = issues.slice(0, MAX_ISSUE_LINES).map((i) => `- ${i.path}: ${i.message}`)
    if (issues.length > MAX_ISSUE_LINES) lines.push(`(+${issues.length - MAX_ISSUE_LINES} more)`)
    return refuse(`Nodaro rejected the request (400 ${error?.code ?? "validation_error"}):\n${lines.join("\n")}`)
  }
  return errorResult(statusCode, body)
}

async function postBuilder(fastify: FastifyInstance, session: McpSession, url: string, payload: Record<string, unknown>) {
  return mcpInject(fastify, session, {
    method: "POST",
    url,
    headers: internalHeaders(session.userId),
    payload: { userId: session.userId, ...payload },
  })
}

interface CharacterIdentity {
  readonly imageUrls: string[]
  readonly description: string
  readonly gender: "woman" | "man" | undefined
}

/** A saved Character's free-text gender, when it clearly names one; anything else means "ask the user". */
export function characterGender(value: string | null | undefined): "woman" | "man" | undefined {
  const g = (value ?? "").trim().toLowerCase()
  if (g === "female" || g === "woman" || g === "f") return "woman"
  if (g === "male" || g === "man" || g === "m") return "man"
  return undefined
}

type PortraitRow = {
  source_image_url: string | null
  reference_photos: Array<{ url?: string; kind?: string }> | null
  body_angles: Array<{ url?: string }> | null
}

/** The portrait first — the approved main image, else a front full-body photo, else the first body angle — then a second distinct one. */
export function characterImages(row: PortraitRow): string[] {
  const candidates = [
    row.source_image_url,
    row.reference_photos?.find((p) => p.kind === "frontBody")?.url,
    row.body_angles?.[0]?.url,
  ].filter((u): u is string => typeof u === "string" && u.length > 0)
  return [...new Set(candidates)].slice(0, 2)
}

/** The caller's own saved Character, scoped exactly as `get_character` reads it. */
async function readCharacter(
  userId: string,
  id: string,
): Promise<{ ok: CharacterIdentity } | { refusal: string }> {
  const { data, error } = await entityOwnerFilter(
    supabase
      .from("characters")
      .select("id, description, canonical_description, gender, source_image_url, reference_photos, body_angles")
      .eq("id", id),
    userId,
  ).maybeSingle()
  if (error) return { refusal: `Error: ${error.message}` }
  if (!data) return { refusal: "Character not found" }
  const row = data as unknown as PortraitRow & { description: string | null; canonical_description: string | null; gender: string | null }
  const imageUrls = characterImages(row)
  if (imageUrls.length === 0) return { refusal: "This Character has no portrait yet" }
  return {
    ok: {
      imageUrls,
      // A blank description counts as none: the saved canonical one is used instead.
      description: (row.description?.trim() || row.canonical_description?.trim() || "").slice(0, DESCRIPTION_MAX),
      gender: characterGender(row.gender),
    },
  }
}

export interface RegisterUgcToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

export function registerUgcTools({ server, session, fastify }: RegisterUgcToolsOpts): void {
  server.registerTool(
    "build_ugc_creator",
    {
      title: "Build UGC Creator",
      description:
        "Prepare the creator for a UGC-style talking-to-camera video: a newly sampled person, one of your saved " +
        "Characters, or your own photo. Returns the creator's identity images, or an image prompt with the exact " +
        "arguments for the image generations to run next, one per candidate. Free: it generates nothing. Used by " +
        "the ugc-website recipe (get_recipe).",
      inputSchema: {
        source: z.enum(["sampled", "character", "photo"]),
        gender: z.enum(["woman", "man"]).optional(),
        product_category: z.string().optional(),
        overrides: z.record(z.string(), z.string()).optional(),
        previous: z.record(z.string(), z.unknown()).optional(),
        character_id: z.string().uuid().optional(),
        photo_url: z.string().url().optional(),
        seed: z.number().int().min(0).max(2147483647).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      let source: Record<string, unknown>
      if (args.source === "sampled") {
        if (!args.gender) return refuse("A sampled creator needs a gender: pass woman or man.")
        if (!args.product_category) return refuse("A sampled creator needs a product_category.")
        source = {
          kind: "sampled",
          gender: args.gender,
          productCategory: args.product_category,
          ...(args.overrides ? { overrides: args.overrides } : {}),
          ...(args.previous ? { previous: args.previous } : {}),
        }
      } else if (args.source === "character") {
        if (!passesGate(session, characterGate)) return refuse(CHARACTER_SCOPE_REFUSAL)
        if (!args.character_id) return refuse("Character not found")
        const character = await readCharacter(session.userId, args.character_id)
        if ("refusal" in character) return refuse(character.refusal)
        // The Character's saved gender wins; the caller's `gender` is the user's answer when it has none.
        const gender = character.ok.gender ?? args.gender
        source = {
          kind: "character",
          imageUrls: character.ok.imageUrls,
          description: character.ok.description,
          ...(gender ? { gender } : {}),
        }
      } else {
        source = { kind: "photo", imageUrl: args.photo_url, ...(args.gender ? { gender: args.gender } : {}) }
      }
      const res = await postBuilder(fastify, session, "/v1/ugc/creator", {
        source,
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
      })
      if (res.statusCode >= 400) return ugcError(res.statusCode, res.body)
      return textResult(JSON.parse(res.body))
    },
  )

  server.registerTool(
    "build_ugc_clips",
    {
      title: "Build UGC Clips",
      description:
        "Check a UGC video script and turn it into clip requests. Pass the script as `plan`. An invalid script " +
        "returns every problem at once, each with a fix to apply before calling again. A valid script returns one " +
        "ready-to-run generate_video call per clip, the call that joins them, and a credit quote for the rest of " +
        "the video. Free: it generates nothing. Used by the ugc-website recipe (get_recipe).",
      inputSchema: {
        plan: z.record(z.string(), z.unknown()),
        gender: z.enum(["woman", "man"]),
        traits: z.record(z.string(), z.unknown()).optional(),
        identity_images: z.array(z.string().min(1)).min(1).max(2),
        seed: z.number().int().min(0).max(2147483647).optional(),
        spent_job_ids: z
          .array(z.string())
          .max(UGC_SPENT_JOB_IDS_MAX)
          .optional()
          .describe("Job ids of the calls already made for this video; the quote lists them as already spent."),
        segments: z
          .array(z.record(z.string(), z.unknown()))
          .max(8)
          .optional()
          .describe("The segments from ugc_split_speech's output, when the answer to the first call asked for them. Leave out on the first call."),
        speech_lane: z
          .enum(["prompt-quoted", "reference-audio"])
          .optional()
          .describe("English only. reference-audio (the default): a voice speaks the script and the video model performs it. prompt-quoted: the video model reads the line in its own voice, no ElevenLabs."),
        voice_id: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("English only: the ElevenLabs mode's anchor voice (a premade name or a list_voices id), replacing the builder's pick from the creator."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await postBuilder(fastify, session, "/v1/ugc/clips", {
        plan: args.plan,
        gender: args.gender,
        ...(args.traits ? { traits: args.traits } : {}),
        identityImages: args.identity_images,
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.segments ? { segments: args.segments } : {}),
        ...(args.speech_lane ? { speechLane: args.speech_lane } : {}),
        ...(args.voice_id ? { voiceId: args.voice_id } : {}),
      })
      if (res.statusCode >= 400) return ugcError(res.statusCode, res.body)
      const body = JSON.parse(res.body) as { errors?: unknown[]; quoteItems?: unknown; estimateQuoteItems?: unknown; worstCaseQuoteItems?: unknown; clips?: unknown[] } & Record<string, unknown>
      // An invalid plan comes back as { errors, warnings } — there is nothing to price yet.
      if (Array.isArray(body.errors) && body.errors.length > 0) return textResult(body)
      // A valid plan always carries its quote items: an answer without them is never passed on unpriced.
      if (!Array.isArray(body.quoteItems)) return refuse("could not price the rest of the video")
      const { quoteItems, estimateQuoteItems, worstCaseQuoteItems, ...rest } = body
      // Loaded on demand (the credit-guard shim pattern): core never imports ee/ statically.
      const { buildUgcQuote, UgcQuoteError } = await import("../../../ee/lib/ugc-quote.js")
      // The payer the calls this quote prices will be billed to: the billing hook's own
      // decision, on the inputs every call from this session carries (mcpInject — the
      // internal lane, the session's workspace, never a workflow).
      const billingContext = await requestBillingContext({
        userId: session.userId,
        workspaceId: session.workspaceId,
        isAppRun: false,
        internal: true,
      })
      // A builder that cannot yet know its clip count (it is decided by the recorded speech) says so:
      // `clipCount` / `estimateClipCount` are its own figures; otherwise the answer's clips are counted, as always.
      const count = (own: unknown): number => (typeof own === "number" && Number.isInteger(own) && own >= 0 ? own : Array.isArray(body.clips) ? body.clips.length : 0)
      const price = (items: readonly unknown[], clipCount: number) =>
        buildUgcQuote({ items, clipCount, spentJobIds: args.spent_job_ids ?? [], userId: session.userId, ...(billingContext ? { billingContext } : {}) })
      try {
        const quote = await price(quoteItems, count(body.clipCount))
        // The estimate and the worst case ride only an answer that asks for them (`quote` is the one the user's OK covers).
        const estimate = Array.isArray(estimateQuoteItems) ? await price(estimateQuoteItems, count(body.estimateClipCount)) : undefined
        const worstCase = Array.isArray(worstCaseQuoteItems) ? await price(worstCaseQuoteItems, count(body.worstCaseClipCount)) : undefined
        return textResult({ ...rest, quote, ...(estimate ? { estimate } : {}), ...(worstCase ? { worstCase } : {}) })
      } catch (err) {
        if (err instanceof UgcQuoteError) return refuse(err.message)
        throw err
      }
    },
  )

  server.registerTool(
    "build_ugc_cards",
    {
      title: "Build UGC Cards",
      description:
        "Time the screenshot cards and captions of a UGC video from its word timings. Pass the script as `plan` " +
        "and either `alignment` (from forced_alignment) or `words` (from transcribe). Returns the layers for " +
        "overlay_images and the caption segments for add_captions. Free: it generates nothing. Used by the " +
        "ugc-website recipe (get_recipe).",
      inputSchema: {
        plan: z.record(z.string(), z.unknown()),
        alignment: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
        words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })).optional(),
        video_duration_ms: z.number().min(0).optional(),
        caption_style: z
          .enum(["body-captions", "karaoke", "clean-subtitles", "none"])
          .optional()
          .describe(
            "How the captions after the opening line look: body-captions (word by word, the default), karaoke, " +
              "clean-subtitles, or none. The opening line always keeps its plate.",
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await postBuilder(fastify, session, "/v1/ugc/cards", {
        plan: args.plan,
        ...(args.alignment ? { alignment: args.alignment } : {}),
        ...(args.words ? { words: args.words } : {}),
        ...(args.video_duration_ms !== undefined ? { videoDurationMs: args.video_duration_ms } : {}),
        ...(args.caption_style ? { captionStyle: args.caption_style } : {}),
      })
      if (res.statusCode >= 400) return ugcError(res.statusCode, res.body)
      return textResult(JSON.parse(res.body))
    },
  )

  /** A job-creating plugin route, called as the session: its answer is a job id, read with wait_for_job. */
  async function postJob(url: string, payload: Record<string, unknown>, label: string) {
    const res = await postBuilder(fastify, session, url, payload)
    if (res.statusCode >= 400) return ugcError(res.statusCode, res.body)
    const jobId = parseJobId(res.body)
    if (!jobId) return refuse("the service answered without a job id")
    return jobResultWithWidget({ jobId, label, session })
  }

  server.registerTool(
    "ugc_split_speech",
    {
      title: "Split UGC Speech",
      description:
        "Cut a UGC video's recorded speech into segments at its own pauses, each saved as an audio file with a short " +
        "silence either side. Pass the speech (audio_url or audio_asset_id), its word timings from forced_alignment as " +
        "`alignment`, and the script as `plan`. Returns a job id: its output lists every segment's text, timing and " +
        "audio file, which build_ugc_clips turns into one clip request per segment (pass them as `segments`). " +
        "Charges a flat fee per call. Used by the ugc-website recipe (get_recipe).",
      inputSchema: {
        plan: z.record(z.string(), z.unknown()),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional().describe("Nodaro job id or upload asset id of the speech."),
        alignment: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).min(1).max(2000),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" }) : null)
      if (!audioUrl) return refuse("Pass audio_url or audio_asset_id — the speech to split.")
      return postJob("/v1/ugc/segments", { plan: args.plan, audioUrl, alignment: args.alignment }, "split speech")
    },
  )

  server.registerTool(
    "ugc_finish_clips",
    {
      title: "Finish UGC Clips",
      description:
        "Check every rendered clip against the audio it was given, put that original audio on each clip, and trim the " +
        "dead air between words, then return the finished clips in order, ready to join. On the Hebrew (segmented) lane " +
        "it also gives each clip the sound of its setting: reverb matched to the setting, levelled to -16 LUFS, with " +
        "room tone underneath (outdoor, car and hall settings get the reverb and level but no room tone). If that " +
        "step fails the clips still come back, dry, with a warning. Pass the `segments` from " +
        "ugc_split_speech and one entry per clip: its video (video_url or video_asset_id) and, when it was rendered " +
        "again, the new render as reroll_video_url / reroll_video_asset_id. If a clip does not match its audio the job " +
        "answers which clips to render again and changes nothing. Returns a job id. Charges a flat fee per call. " +
        "Used by the ugc-website recipe (get_recipe).",
      inputSchema: {
        segments: z.array(z.record(z.string(), z.unknown())).min(1).max(8),
        clips: z
          .array(
            z.object({
              clip: z.number().int().min(1).max(8),
              video_url: z.string().url().optional(),
              video_asset_id: z.string().optional(),
              reroll_video_url: z.string().url().optional(),
              reroll_video_asset_id: z.string().optional(),
            }),
          )
          .min(1)
          .max(8),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const urlOf = async (url: string | undefined, assetId: string | undefined): Promise<string | null> =>
        url ?? (assetId ? await resolveAssetId({ assetId, userId: session.userId, expectedKind: "video" }) : null)
      const clips: Array<{ clip: number; rolls: string[] }> = []
      for (const c of args.clips) {
        const first = await urlOf(c.video_url, c.video_asset_id)
        if (!first) return refuse(`Clip ${c.clip}: pass video_url or video_asset_id.`)
        const again = await urlOf(c.reroll_video_url, c.reroll_video_asset_id)
        clips.push({ clip: c.clip, rolls: again ? [first, again] : [first] })
      }
      return postJob("/v1/ugc/finish", { segments: args.segments, clips }, "finish clips")
    },
  )
}

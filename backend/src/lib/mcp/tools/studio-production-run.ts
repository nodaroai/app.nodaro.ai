import { z } from "zod"

import { passesGate, type ToolGate } from "../tool-schemas.js"
import { clientRequestIdSchema } from "./_verb-helpers.js"
import {
  confirmMeta,
  studioError,
  studioInject,
  studioPayload,
  viewResult,
} from "./_studio-helpers.js"
import type { RegisterStudioProductionToolsOpts } from "./studio-production.js"

/**
 * The seven studio production tools that SPEND: a framing or directing run, a
 * frame grab, a voiceover, a revoice, a soundtrack, and the Director draft that
 * writes a whole production from a brief.
 *
 * Split out of `studio-production.ts` for size, not for taste — the family is
 * one surface, and a test pins the names both halves register to
 * `STUDIO_PRODUCTION_TOOL_NAMES`.
 * What they share, and what makes them a set:
 *
 *  - **The gate is a conjunction.** Their routes authorize on `workflows:write`
 *    and they spend, which is `workflows:execute`. Registering them under
 *    `execute` alone would show a tool the route then refuses with a 403 —
 *    "register a tool where its route is" is the family's rule, so a session
 *    needs both grants to see them at all.
 *  - **Credits are never pre-checked here.** The routes submit to the same
 *    priced single-node routes the studio app uses, which reserve atomically
 *    and answer typed refusals; `dry_run` is the quote asked for explicitly.
 *  - **They start work, they do not wait for it.** A run comes back as job ids
 *    on the production; poll `get_studio_production` (which shows what is in
 *    flight) or `get_job`. The frame and voice lanes are the exception — they
 *    are seconds long and the route waits.
 *  - **Every one takes `client_request_id`**, because a dropped connection on a
 *    spending call must not be able to charge twice.
 */

/**
 * Both grants. See the note above: the route's scope AND the spend class, so a
 * visible tool is always one the route will actually run.
 */
const runGate: ToolGate = { required: ["workflows:write", "workflows:execute"] }

const productionId = z.string().uuid().describe("The production.")
const shotId = z.string().min(1).describe("The shot, by its id (see `get_studio_production`).")

/**
 * The levers a single call has over what the shot's plan already says — the
 * provider, the prompt, the aspect, the direction ids. Left open on purpose:
 * the server owns the lever list, and a restatement of it here would be a
 * second spelling that drifts the first time one is added.
 */
const overrides = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Per-call overrides of the shot's own settings. See the operating skill.")

const dryRun = z
  .boolean()
  .optional()
  .describe("Price it and stop — no job is started and nothing is charged.")

export function registerStudioProductionRunTools({
  server,
  session,
  fastify,
}: RegisterStudioProductionToolsOpts): void {
  if (!passesGate(session, runGate)) return

  /** POST to a production sub-route and hand back what it answered. */
  const post = async (id: string, path: string, body: Record<string, unknown>) => {
    const res = await studioInject(fastify, session, {
      method: "POST",
      url: `/v1/studio/productions/${encodeURIComponent(id)}/${path}`,
      payload: studioPayload(session, body),
    })
    if (res.statusCode >= 400) return studioError(res.statusCode, res.body)
    return viewResult(res.body)
  }

  // ── describe: a Director run that writes the production ───────────────────
  server.registerTool(
    "describe_studio_production",
    {
      title: "Draft Studio Production From A Brief",
      description:
        "Hand a BRIEF to the Director and let it write the production — scenes, " +
        "shots, cast and looks — into an existing production. Costs an LLM run, " +
        "not a render. It returns a job id and a marker on the production: the " +
        "draft lands by itself when the run finishes, so poll " +
        "`get_studio_production` rather than waiting. Use it when the user has a " +
        "story rather than a plan; author the plan yourself and " +
        "`create_studio_production` when you already know the shots.",
      inputSchema: {
        production_id: productionId,
        brief: z
          .string()
          .min(1)
          .max(100000)
          .describe("What the film is — the story, the tone, the constraints."),
        llm_model: z.string().min(1).describe("The LLM to draft with (see `list_models`)."),
        mode: z
          .enum(["append", "replace"])
          .optional()
          .describe("append (default) adds scenes; replace rewrites the production."),
        label: z.string().max(200).optional().describe("A name for the run."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "describe", {
        brief: args.brief,
        llmModel: args.llm_model,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.label ? { label: args.label } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── framing: the shot's still ─────────────────────────────────────────────
  server.registerTool(
    "generate_studio_still",
    {
      title: "Generate Studio Still",
      description:
        "Frame a shot: generate `count` candidate images from what the shot " +
        "already says (its prompt, references, cast bindings and direction), " +
        "plus any `overrides` for this call. Spends credits per candidate — " +
        "`dry_run: true` prices it first. Returns job ids; the images land on " +
        "the shot's result history by themselves, so poll " +
        "`get_studio_production`. Generating again ADDS takes, it never " +
        "replaces one.",
      inputSchema: {
        production_id: productionId,
        shot_id: shotId,
        count: z.number().int().min(1).max(10).optional().describe("Candidates. Omit for the shot's own default."),
        overrides,
        dry_run: dryRun,
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "generate", {
        kind: "still",
        shotId: args.shot_id,
        ...(args.count !== undefined ? { count: args.count } : {}),
        ...(args.overrides ? { overrides: args.overrides } : {}),
        ...(args.dry_run ? { dryRun: true } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── directing: the shot's clip ────────────────────────────────────────────
  server.registerTool(
    "generate_studio_clip",
    {
      title: "Generate Studio Clip",
      description:
        "Animate a shot into a video from its still, its frames and its " +
        "direction. The lane is chosen from the inputs — pass `mode` only to " +
        'force one ("start" animates from the start frame, "references" from ' +
        "the shot's reference media). Spends credits; `dry_run: true` prices it " +
        "and starts nothing. Returns a job id and marks the shot as rendering, " +
        "so the clip lands by itself — poll `get_studio_production`. A framing " +
        "run and a directing run can be in flight at the same time.",
      inputSchema: {
        production_id: productionId,
        shot_id: shotId,
        mode: z
          .enum(["start", "references"])
          .optional()
          .describe("Force the directing lane. Omit to let the inputs decide."),
        overrides,
        dry_run: dryRun,
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "generate", {
        kind: "clip",
        shotId: args.shot_id,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.overrides ? { overrides: args.overrides } : {}),
        ...(args.dry_run ? { dryRun: true } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── a frame out of the shot's clip ────────────────────────────────────────
  server.registerTool(
    "new_studio_shot_from_frame",
    {
      title: "New Studio Shot From Frame",
      description:
        "Grab a frame out of a shot's current video and put it to work: " +
        'target "new-shot" (the default) opens the next shot on it — the way a ' +
        'sequence is continued — while "start-frame" / "end-frame" pin it as ' +
        'this shot\'s own endpoint and "still" adds it as a take. Take the ' +
        'first or last frame, or a "timestamp" in seconds. Costs a frame ' +
        "extraction; the route waits for it and answers with the updated " +
        "production.",
      inputSchema: {
        production_id: productionId,
        shot_id: shotId,
        mode: z
          .enum(["first", "last", "timestamp"])
          .optional()
          .describe('Which frame. Default "first".'),
        timestamp: z.number().min(0).optional().describe('Seconds, for mode "timestamp".'),
        target: z
          .enum(["new-shot", "start-frame", "end-frame", "still"])
          .optional()
          .describe('What to do with it. Default "new-shot".'),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "frame", {
        shotId: args.shot_id,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.timestamp !== undefined ? { timestamp: args.timestamp } : {}),
        ...(args.target ? { target: args.target } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── voice: a spoken line for the shot ─────────────────────────────────────
  server.registerTool(
    "voice_studio_shot",
    {
      title: "Voice Studio Shot",
      description:
        "Speak a line over a shot — the voiceover lane. Give the `text`; pick a " +
        "`voice_id` from `list_voices` or let the shot's own voice settings " +
        "stand. Costs a text-to-speech run; the route waits for it and answers " +
        "with the updated production.",
      inputSchema: {
        production_id: productionId,
        shot_id: shotId,
        text: z.string().min(1).max(40000).describe("The line to speak."),
        voice_id: z.string().optional().describe("A voice from `list_voices`."),
        voice_type: z.enum(["premade", "custom", "library"]).optional(),
        tts_provider: z.string().optional().describe("The speech provider, when it matters."),
        delivery: z
          .record(z.string(), z.number())
          .optional()
          .describe("Delivery levers (speed, stability, …). The route clamps them."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "voice", {
        shotId: args.shot_id,
        text: args.text,
        ...(args.voice_id ? { voiceId: args.voice_id } : {}),
        ...(args.voice_type ? { voiceType: args.voice_type } : {}),
        ...(args.tts_provider ? { ttsProvider: args.tts_provider } : {}),
        ...(args.delivery ? { delivery: args.delivery } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── revoice: recast the voices inside the shot's clip ─────────────────────
  server.registerTool(
    "revoice_studio_clip",
    {
      title: "Revoice Studio Clip",
      description:
        "Replace the voices inside a shot's current video — the dialogue is " +
        "re-performed and mixed back over the same picture. Takes a `plan` " +
        "naming which speaker gets which voice (see the operating skill for its " +
        "shape). Spends credits and returns a job id; poll " +
        "`get_studio_production`.",
      inputSchema: {
        production_id: productionId,
        shot_id: shotId,
        plan: z.record(z.string(), z.unknown()).describe("The revoice plan."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "revoice", {
        shotId: args.shot_id,
        plan: args.plan,
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  // ── score: the film's soundtrack ──────────────────────────────────────────
  server.registerTool(
    "score_studio_production",
    {
      title: "Score Studio Production",
      description:
        "Write the film a soundtrack from a `prompt` describing the music. One " +
        "track for the whole production, not per shot. Spends credits and " +
        "returns a job id; the track lands on the production by itself, so poll " +
        "`get_studio_production`.",
      inputSchema: {
        production_id: productionId,
        prompt: z.string().min(1).max(2000).describe("The music: mood, instruments, genre."),
        duration: z.number().min(1).max(600).optional().describe("Seconds."),
        instrumental: z.boolean().optional().describe("No vocals."),
        vocal_gender: z.string().optional(),
        model: z.string().optional().describe("The music model (see `list_models`)."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: confirmMeta("$"),
    },
    async (args) =>
      post(args.production_id, "music", {
        prompt: args.prompt,
        ...(args.duration !== undefined ? { duration: args.duration } : {}),
        ...(args.instrumental !== undefined ? { instrumental: args.instrumental } : {}),
        ...(args.vocal_gender ? { vocalGender: args.vocal_gender } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )
}

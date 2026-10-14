/**
 * Podcast use-case verbs: one call per use-case over the editing primitives
 * (`tighten_episode` → POST /v1/tighten-episode, `continue_use_case` → POST
 * /v1/tighten-episode/continue). CORE and ungated like `apply_edl`: the route
 * answers an install that cannot run it (unconnected, keyless) with its own
 * honest 503 before any charge. Its own module (the video verbs file is past
 * 3,000 lines); `registerVideoVerbs` calls it after its `workflows:execute`
 * gate, and the gate is checked here too.
 *
 * The wrapper job a run answers with is registered as an MCP task, so a task
 * cancel reaches it (lib/mcp/tasks.ts routes a use-case wrapper through
 * cancelOwnedJob, which refunds and stops the hidden run).
 *
 * Refusals keep what the agent needs to act: a continuation refused because
 * another run already covers it names that run's job id, and says whether to
 * follow it, continue it instead, or ask again in a moment.
 */
import { z } from "zod"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import { EDIT_PLAN_TIERS, EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import {
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  TIGHTEN_EPISODE,
  TIGHTEN_EPISODE_DEFAULTS,
  usecaseFeeCreditId,
} from "@nodaro/render-rules"
import { hasCredits } from "../../config.js"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { creditsOf } from "./_credit-hint.js"
import type { RegisterOpts } from "./verbs-image.js"
import { clientRequestIdSchema, dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }
const tuple = (list: readonly string[]) => list as unknown as [string, ...string[]]
const D = TIGHTEN_EPISODE_DEFAULTS

/** The run's price, as the description states it — the fee read from the static table, never typed. */
function priceSentence(): string {
  if (!hasCredits()) return ""
  return ` Priced as its steps at their own rates plus a per-run fee of ${creditsOf(usecaseFeeCreditId(TIGHTEN_EPISODE))} credits.`
}

/** What to do next when a refusal names another run (`jobId` on the answer). */
const NEXT_STEP: Readonly<Record<string, (jobId: string | undefined) => string>> = {
  already_running: (id) =>
    id ? ` That run is job ${id}: follow it with get_job or wait_for_job instead of starting another.` : "",
  continuation_superseded: (id) =>
    id ? ` Continue job ${id} instead: continue_use_case with job_id "${id}".` : "",
  render_final_already_rendered: (id) =>
    id ? ` That render is job ${id}: read it with get_job. Change the edit to render again.` : "",
  continuation_settling: () => " Call continue_use_case again in a few seconds.",
}

function refusalText(statusCode: number, body: string): string | null {
  let code: string | undefined
  let message: string | undefined
  let jobId: string | undefined
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown }; jobId?: unknown }
    if (typeof parsed?.error?.code === "string") code = parsed.error.code
    if (typeof parsed?.error?.message === "string") message = parsed.error.message
    if (typeof parsed?.jobId === "string") jobId = parsed.jobId
  } catch {
    return null
  }
  if (!code || !message) return null
  // The use-case routes' 503s are their own words (no connection, no key, not
  // available on this server yet) — never a raw upstream body.
  if (statusCode === 503) return `Nodaro cannot run this here (503 ${code}): ${message}`
  if (statusCode === 402) return `Nodaro: insufficient credits (${code}): ${message}`
  if (statusCode !== 409) return null
  const next = NEXT_STEP[code]?.(jobId) ?? (jobId ? ` (job ${jobId})` : "")
  return `Nodaro rejected the request (409 ${code}): ${message}${next}`
}

export function registerUseCaseVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return
  // A deployment that does not offer the node lists neither tool (the routes refuse it too).
  if (isNodeDenied(TIGHTEN_EPISODE, USER_VIEWER)) return

  server.registerTool(
    "tighten_episode",
    {
      title: "Tighten Episode",
      description:
        "Tighten a podcast or interview recording in one call: transcribes it (speakers labelled), finds the silences, " +
        "plans the tightened cut, renders it, and optionally adds captions and a music bed ducked under the voice. " +
        "Pass `media_url` (a video or audio recording, up to 3 hours). `output`: `video` (default) or `audio` — an audio " +
        "recording always makes an audio episode. `review_before_render: true` stops at a quick proxy preview: inspect " +
        "`output_data.json` (the edit), then call `continue_use_case` with `mode: \"render-final\"` (optionally `edited_edl`). " +
        "If a run fails, `continue_use_case` with `mode: \"from-failed\"` re-runs only the steps that did not finish — " +
        "finished steps are kept and not charged again. Returns a job id: the episode is the job result " +
        "(`output_data.videoUrl` or `audioUrl`), the edit is `output_data.json`." +
        priceSentence(),
      inputSchema: {
        media_url: z.string().url().describe("The recording (video or audio URL)."),
        music_url: z.string().url().optional().describe("Optional music bed, ducked under the voice and ending with the episode."),
        output: z.enum(["video", "audio"]).optional().describe("video (default) or an audio-only episode."),
        framing_aspect: z
          .enum(tuple(EDL_TARGET_ASPECTS))
          .optional()
          .describe("Frame a video episode for this shape with Speaker View (automatic boxes over the speakers on screen). Omit for no framing."),
        framing_layout: z
          .enum(tuple(SPEAKER_VIEW_LAYOUT_SETTINGS))
          .optional()
          .describe("Layout when framing_aspect is set (default auto; one the shape does not draw is snapped). Ignored without framing_aspect."),
        captions: z.boolean().optional().describe(`Burn captions into a video episode (default ${D.captions}).`),
        caption_style: z.enum(tuple(ALL_CAPTION_STYLES)).optional().describe(`Caption style (default ${D.captionStyle}).`),
        review_before_render: z.boolean().optional().describe(`Stop at a proxy preview for review (default ${D.reviewBeforeRender}).`),
        plan_tier: z.enum(tuple(EDIT_PLAN_TIERS)).optional().describe(`Editing quality (default ${D.planTier}).`),
        instructions: z.string().max(4000).optional().describe("Editing instructions for the plan."),
        style_guide: z.string().max(4000).optional().describe("Style guide for the plan."),
        music_duck_amount: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(`How far the music dips under speech, 0–100 (default ${D.musicDuckAmount}).`),
        client_request_id: clientRequestIdSchema.optional(),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) =>
      dispatchJob(fastify, session, {
        url: "/v1/tighten-episode",
        label: "Tighten Episode",
        formatRefusal: refusalText,
        payload: {
          mediaUrls: [args.media_url],
          ...(args.music_url ? { musicUrl: args.music_url } : {}),
          ...(args.output ? { output: args.output } : {}),
          ...(args.framing_aspect ? { framing: { aspect: args.framing_aspect, layout: args.framing_layout ?? "auto" } } : {}),
          ...(args.captions !== undefined ? { captions: args.captions } : {}),
          ...(args.caption_style ? { captionStyle: args.caption_style } : {}),
          ...(args.review_before_render !== undefined ? { reviewBeforeRender: args.review_before_render } : {}),
          ...(args.plan_tier ? { planTier: args.plan_tier } : {}),
          ...(args.instructions ? { instructions: args.instructions } : {}),
          ...(args.style_guide ? { styleGuide: args.style_guide } : {}),
          ...(args.music_duck_amount !== undefined ? { musicDuckAmount: args.music_duck_amount } : {}),
          // The agent that asked for a review IS its reviewer (it reads the
          // preview and calls continue_use_case render-final). MCP calls come
          // in on the internal lane, where only a forwarded true counts.
          ...(args.review_before_render === true ? { reviewerPresent: true } : {}),
          mcp_client: session.clientName,
          userId: session.userId,
        },
        widgetKind: args.output === "audio" ? "audio" : "video",
        widgetData: { prompt: "(tighten episode)" },
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )

  server.registerTool(
    "continue_use_case",
    {
      title: "Continue a use-case run",
      description:
        "Continue a Tighten Episode run as a NEW job (see `mode`): a failed run, or the final of a review preview, " +
        "optionally with `edited_edl` (the reviewed edit). Pass `job_id` " +
        "(the earlier run's job). Returns the new job id. A refusal that names another job says what to do: follow a run " +
        "already under way, continue the newer failed run instead, or ask again in a moment while a failed run settles.",
      inputSchema: {
        job_id: z.string().uuid().describe("The earlier run's job id."),
        mode: z
          .enum(["from-failed", "render-final"])
          .describe(
            "from-failed: resume a failed run; finished steps are kept, not re-charged; the fee is held again (the failed run's was refunded). " +
              "render-final: a review_before_render preview at full quality, its settings; no fee.",
          ),
        edited_edl: z.record(z.string(), z.unknown()).optional().describe("render-final only: the reviewed edit."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) =>
      dispatchJob(fastify, session, {
        url: "/v1/tighten-episode/continue",
        label: "Tighten Episode",
        formatRefusal: refusalText,
        payload: {
          jobId: args.job_id,
          mode: args.mode,
          ...(args.edited_edl ? { editedEdl: args.edited_edl } : {}),
          // The agent continuing its own run is that run's reviewer. The route
          // reads it only when the run it continues has review on.
          reviewerPresent: true,
          mcp_client: session.clientName,
          userId: session.userId,
        },
        widgetKind: "video",
        widgetData: { prompt: `(continue · ${args.mode})` },
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      }),
  )
}

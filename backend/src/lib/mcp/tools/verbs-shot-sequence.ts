import { z } from "zod"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { resolveAssetId } from "../asset-resolver.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

export function registerShotSequenceVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return
  // ── forced_alignment ──
  server.registerTool(
    "forced_alignment",
    {
      title: "Forced Alignment",
      description:
        "Align a known transcript to audio (ElevenLabs forced alignment), returning per-word start/end " +
        "timings. Returns a job_id; the alignment is in the job output (output_data.alignment). " +
        "Use this to drive shot-sequence reveals (resolve_shot_sequence).",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional().describe("Nodaro audio job id."),
        transcript: z.string().min(1).max(50000).describe("The exact words spoken in the audio."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" })
          : null)
      if (!audioUrl)
        return { content: [{ type: "text" as const, text: "Pass audio_url or audio_asset_id." }], isError: true }
      return dispatchJob(fastify, session, {
        url: "/v1/forced-alignment",
        payload: { audioUrl, transcript: args.transcript, mcp_client: session.clientName, userId: session.userId },
        label: "forced alignment",
        widgetKind: "generic",
        widgetData: { prompt: "(forced alignment)", model: "elevenlabs-forced-alignment" },
      })
    },
  )

  // ── resolve_shot_sequence ──
  server.registerTool(
    "resolve_shot_sequence",
    {
      title: "Resolve Shot Sequence",
      description:
        "Bake an authored shot-sequence brief into a render-ready plan by aligning its voiceover cues to " +
        "forced-alignment word timings. Pure + synchronous: returns the plan inline (no job). Feed the " +
        "plan to render_shot_sequence. A brand `logo.image` is not auto-injected here; include a " +
        "`logo-assemble-lockup` reveal yourself if you want the logo shown.",
      inputSchema: {
        brief: z.record(z.unknown()).describe("A ShotSequenceBrief (see docs/mcp/shot-sequence.md)."),
        audio_url: z.string().url().describe("The narration audio (from generate_speech)."),
        alignment: z
          .array(z.object({ word: z.string(), start: z.number(), end: z.number() }))
          .describe("forced_alignment output_data.alignment (seconds)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/shot-sequence/resolve",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { brief: args.brief, audioUrl: args.audio_url, alignment: args.alignment, userId: session.userId },
      })
      if (res.statusCode >= 400) {
        return {
          content: [{ type: "text" as const, text: `Resolve failed (${res.statusCode}): ${res.body}` }],
          isError: true,
        }
      }
      const parsed = JSON.parse(res.body) as { plan: unknown; warnings?: string[] }
      const warnings = parsed.warnings ?? []
      const warningText = warnings.length > 0 ? `\n\nWarnings:\n- ${warnings.join("\n- ")}` : ""
      return {
        content: [
          {
            type: "text" as const,
            text: `Resolved shot-sequence plan.${warningText}\n\nPass this plan to render_shot_sequence:\n${JSON.stringify(parsed.plan)}`,
          },
        ],
      }
    },
  )

  // ── render_shot_sequence ──
  server.registerTool(
    "render_shot_sequence",
    {
      title: "Render Shot Sequence",
      description:
        "Render a resolved shot-sequence plan to an MP4 on Nodaro's Remotion engine. Returns a job_id; " +
        "progress and the finished video appear in the tool card.",
      inputSchema: {
        plan: z.record(z.unknown()).describe("A resolved ShotSequencePlan from resolve_shot_sequence."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      return dispatchJob(fastify, session, {
        url: "/v1/render-video/plan",
        payload: {
          planType: "shot-sequence",
          plan: args.plan,
          mcp_client: session.clientName,
          userId: session.userId,
        },
        label: "shot-sequence render",
        widgetKind: "video",
        widgetData: { prompt: "(shot-sequence)", model: "shot-sequence" },
      })
    },
  )
}

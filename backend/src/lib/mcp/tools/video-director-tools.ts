import { z } from "zod"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { brandTokensSchema } from "../../plan-schemas.js"
import type { RegisterOpts } from "./verbs-image.js"

/**
 * One-shot "make me a video" director tools (HyperFrames Phase 1 — Unit E).
 *
 * Each tool dispatches to `POST /v1/video-director/run`, whose `creditGuard`
 * preHandler reserves the authoring credit (the MCP tool files are CORE and
 * cannot statically import the ee/ credit code — the route is the seam). The
 * route enqueues the director chain (author → speech → alignment → bake →
 * render) and returns a jobId; the rendered MP4 lands in the user's library.
 *
 * Family-gated on `workflows:execute` (these spend credits and produce a
 * render job), mirroring verbs-shot-sequence.ts.
 */
const executeGate: ToolGate = { required: ["workflows:execute"] }

/**
 * Shared `brand` MCP input — a preset name (string) OR inline brand tokens.
 * Single source of truth for both create_explainer and create_launch_video:
 * validating against `brandTokensSchema` (not a loose record) gives MCP clients
 * real structural validation of inline tokens.
 */
const brandParamSchema = z
  .union([z.string(), brandTokensSchema])
  .optional()
  .describe(
    "Optional brand: a preset name (e.g. \"cobalt-corporate\") OR inline brand tokens " +
      "({ palette, fonts, logo }). Applied to every scene's colors and fonts.",
  )

/** Returned verbatim when a caller passes a product `url` but no `brief`.
 *  Real-UI capture (scrape the page, screenshot the product) is a deferred
 *  capability — we never silently fabricate a brief from a bare URL. */
const URL_ONLY_DEFERRED_MESSAGE =
  "Real-UI capture isn't supported yet — pass `brief` describing the product instead."

export function registerVideoDirectorTools({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return

  // ── create_explainer ──
  server.registerTool(
    "create_explainer",
    {
      title: "Create Explainer Video",
      description:
        "Author and render a narrated, time-coded explainer video from a topic. Nodaro's video " +
        "director writes the script + shot sequence, generates the voiceover, aligns it word-by-word, " +
        "and renders an MP4 on the Remotion engine. Returns a job_id; progress and the finished " +
        "video appear in the tool card. This is motion-graphics on the Remotion engine (typography " +
        "+ shapes) — if the user wants illustrated/animated scenes, or didn't specify, do not choose " +
        "for them: ask which style they want, then route — motion graphics stays here; " +
        "illustrated/animated footage goes to get_recipe recipe \"video-explainer\".",
      inputSchema: {
        topic: z
          .string()
          .min(1)
          .max(8000)
          .describe("What the explainer video should teach or cover."),
        brand: brandParamSchema,
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      return dispatchJob(fastify, session, {
        url: "/v1/video-director/run",
        payload: {
          genre: "explainer",
          brief: args.topic,
          brand: args.brand,
          mcp_client: session.clientName,
          userId: session.userId,
        },
        label: "explainer video",
        widgetKind: "video",
        widgetData: { prompt: "(explainer)", model: "video-director" },
      })
    },
  )

  // ── create_launch_video ──
  server.registerTool(
    "create_launch_video",
    {
      title: "Create Product Launch Video",
      description:
        "Author and render a narrated product-launch video. Pass `brief` describing the product " +
        "(what it is, who it's for, the tone). Returns a job_id; progress and the finished video " +
        "appear in the tool card. (A `url` to auto-capture the product is not supported yet — " +
        "describe it in `brief`.)",
      inputSchema: {
        brief: z
          .string()
          .min(1)
          .max(8000)
          .optional()
          .describe("Describe the product to launch (features, audience, tone)."),
        url: z
          .string()
          .optional()
          .describe("(Not supported yet) a product URL to capture — pass `brief` instead."),
        brand: brandParamSchema,
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      // URL-only capture is deferred — never silently fabricate a brief.
      if (args.url && !args.brief) {
        return { content: [{ type: "text" as const, text: URL_ONLY_DEFERRED_MESSAGE }] }
      }
      // No brief at all (and no url): ask for one rather than dispatch an empty
      // brief the route's Zod would reject with a generic validation error.
      if (!args.brief) {
        return {
          content: [{ type: "text" as const, text: "Pass `brief` describing the product to launch." }],
          isError: true as const,
        }
      }
      return dispatchJob(fastify, session, {
        url: "/v1/video-director/run",
        payload: {
          genre: "product-launch",
          brief: args.brief,
          brand: args.brand,
          mcp_client: session.clientName,
          userId: session.userId,
        },
        label: "product-launch video",
        widgetKind: "video",
        widgetData: { prompt: "(product-launch)", model: "video-director" },
      })
    },
  )
}

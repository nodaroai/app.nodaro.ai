// @registry-lookup reads Edit Video Pro's own span bounds off its NODE_REGISTRY entry
/**
 * `replace_video_span` — the MCP face of the Edit Video Pro node
 * (`POST /v1/edit-video-pro`): replace a span of TIME inside a video with
 * newly generated content, stitched back into the source. Its own module (the
 * video verbs file is already past 3,000 lines); `registerVideoVerbs` calls it
 * after its `workflows:execute` gate.
 *
 * Nodaro Cloud only (`hasCredits()`), as `plan_edit` is: the tool prices a run
 * before it starts (`estimate_only` → POST /v1/quote, a route only that
 * edition has), and a self-host reaches the node from the canvas.
 *
 * The route is the authority on the span (its floor and ceiling, and that it
 * ends inside the video) and answers each with a sentence; nothing here
 * repeats those rules. The model list is the family the node is drawn from
 * less the models it holds back (`isEditVideoProProvider`), never a list
 * written here.
 */
import { z } from "zod"
import { SEEDANCE_2_PROVIDERS, editVideoProProviderRefusal, isEditVideoProProvider } from "@nodaro/shared/models"
import { hasCredits } from "../../config.js"
import { NODE_REGISTRY } from "../../node-registry.js"
import { resolveAssetId } from "../asset-resolver.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { estimateOnlySchema, estimateOutputSchema, nodeQuoteResult } from "./_node-quote.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import type { RegisterOpts } from "./verbs-image.js"

/** The span's bounds, as the node's own registry entry states them (the ceiling is the deployment's setting). */
function spanBounds(): { min: number; max: number } {
  const node = NODE_REGISTRY.find((n) => n.type === "edit-video-pro")
  return { min: node?.spanMinSec ?? 4, max: node?.maxSpanSec ?? 120 }
}

const TOOL = "replace_video_span"
const LABEL = "Edit Video Pro"

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

/** The models the node offers, in the family's own order. */
const spanModels = (): string[] => [...SEEDANCE_2_PROVIDERS].filter((id) => isEditVideoProProvider(id))

export function registerReplaceVideoSpanVerb({ server, session, fastify }: RegisterOpts): void {
  // Read when the tool is registered, never while this module loads.
  const { min: SPAN_MIN_SEC, max: SPAN_MAX_SEC } = spanBounds()
  if (!hasCredits()) return

  server.registerTool(
    TOOL,
    {
      title: "Replace Video Span",
      description:
        "Replace a span of TIME inside a video (not a region of the frame) with newly generated " +
        "content, stitched back into the source: everything before `span_start` and after " +
        `\`span_end\` stays as it was. The span is ${SPAN_MIN_SEC}-${SPAN_MAX_SEC} seconds and must end inside the video. ` +
        "Provide `video_url` or `video_asset_id`. `estimate_only: true` prices it first: the most " +
        "the edit can cost (it is charged for what it generates); nothing is created or charged. " +
        "Returns a job_id.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        span_start: z.number().min(0).describe("Seconds from the start of the video."),
        span_end: z.number().positive().describe(`Seconds; ${SPAN_MIN_SEC}-${SPAN_MAX_SEC} after span_start.`),
        prompt: z.string().min(1).describe("What happens in the span."),
        model: z.string().optional().describe(`One of ${spanModels().join(", ")}. Omit for the default.`),
        reference_image_urls: z.array(z.string().url()).max(9).optional().describe("Pictures the new content may draw on."),
        generate_audio: z.boolean().optional().describe("Generate the span's sound too. Default true."),
        estimate_only: estimateOnlySchema,
      },
      outputSchema: {
        ...JOB_OUTPUT_SCHEMA,
        // Absent from an estimate, which starts no job and answers `estimate` alone.
        jobId: z.string().optional(),
        estimate: estimateOutputSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobVideo),
    },
    async (args) => {
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })
          : null)
      if (!videoUrl) return refuse("Pass video_url or video_asset_id.")
      if (args.model !== undefined && !isEditVideoProProvider(args.model)) {
        return refuse(
          editVideoProProviderRefusal(args.model) ??
            `"${args.model}" is not a model of ${TOOL}. Options: ${spanModels().join(", ")}.`,
        )
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        spanStart: args.span_start,
        spanEnd: args.span_end,
        prompt: args.prompt,
        ...(args.model !== undefined ? { provider: args.model } : {}),
        ...(args.reference_image_urls?.length ? { referenceImageUrls: [...args.reference_image_urls] } : {}),
        ...(args.generate_audio !== undefined ? { generateAudio: args.generate_audio } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (args.estimate_only === true) {
        return nodeQuoteResult(fastify, session, { tool: TOOL, label: LABEL, type: "edit-video-pro", params: payload })
      }
      return dispatchJob(fastify, session, {
        url: "/v1/edit-video-pro",
        payload,
        label: LABEL,
        widgetKind: "video",
        widgetData: { prompt: args.prompt, ...(args.model !== undefined ? { model: args.model } : {}) },
      })
    },
  )
}

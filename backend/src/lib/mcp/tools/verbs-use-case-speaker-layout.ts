/**
 * `speaker_layout` → POST /v1/speaker-layout (decided 2026-10-17): Speaker
 * Layout's own verb, one of the use-case verbs registered by builder
 * (verbs-use-case.ts `REGISTER_BY_BUILDER`). Its own module so verbs-use-case.ts
 * stays under its size budget; the description's price sentence and the
 * refusal wording are that file's, handed in, so every use-case verb says them
 * alike. The recordings and the framing source are the shared shapes
 * (verbs-use-case-recordings.ts, verbs-use-case-framing.ts).
 */
import { z } from "zod"
import { EDL_TARGET_ASPECTS, SPEAKER_SWITCH_IDS } from "@nodaro/shared/edl"
import {
  SPEAKER_LAYOUT_DEFAULTS,
  SPEAKER_VIEW_EMPHASIS_ATOMS,
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  isClipPackEmphasis,
  usecaseDescriptor,
  usecaseTypeOfBuilder,
  type UseCaseNodeType,
} from "@nodaro/render-rules"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { clientRequestIdSchema, dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { framingSourceInputShape, framingSourcePayload } from "./verbs-use-case-framing.js"
import { RECORDINGS_SENTENCE, recordingsInputShape, recordingsPayload } from "./verbs-use-case-recordings.js"

const tuple = (list: readonly string[]) => list as unknown as [string, ...string[]]
const D = SPEAKER_LAYOUT_DEFAULTS
/** The emphasis values, named from the atoms Speaker View draws. */
const EMPHASIS_VALUES = `"none", or ${SPEAKER_VIEW_EMPHASIS_ATOMS.join(", ")} joined with "+" (each once)`

/** What verbs-use-case.ts hands every verb it registers from another module. */
export interface UseCaseVerbWords {
  /** The type's run price, as a description states it (empty without credits). */
  readonly priceSentence: (type: UseCaseNodeType) => string
  /** A refusal in the agent's words, or null for the default. */
  readonly refusalText: (statusCode: number, body: string) => string | null
}

export function registerSpeakerLayout({ server, session, fastify }: RegisterOpts, words: UseCaseVerbWords): void {
  const TYPE = usecaseTypeOfBuilder("speakerLayout")
  const LABEL = usecaseDescriptor(TYPE).label
  server.registerTool(
    "speaker_layout",
    {
      title: "Speaker Layout",
      description:
        "Frame a whole podcast or interview recording by speaker in one call — the same length, nothing cut: transcribes it and " +
        `frames each speaker with Speaker View (default ${D.targetAspect}, ${D.layout}). Pass \`media_url\` (a video recording, up to 3 hours; ` +
        "an audio-only recording is refused), or `media_urls` (several cameras of one conversation) and optionally `master_audio_url`: " +
        "the recordings are lined up and each speaker is shown on their own camera. " +
        RECORDINGS_SENTENCE +
        " `review_before_render: true` stops at a quick proxy preview (`output_data.videoUrl`): watch it, then `continue_use_case` " +
        "with `mode: \"render-final\"` (no edit: the layout has no cut to change). Returns a job id: the framed video is " +
        "`output_data.videoUrl`, the edit Speaker View drew `output_data.json`. If a run fails, `continue_use_case` with " +
        "`mode: \"from-failed\"` re-runs only the steps that did not finish." +
        words.priceSentence(TYPE),
      inputSchema: {
        ...recordingsInputShape,
        media_url: recordingsInputShape.media_url.describe("The recording (a video URL; audio-only is refused). Or `media_urls`."),
        target_aspect: z.enum(tuple(EDL_TARGET_ASPECTS)).optional().describe(`The video's shape (default ${D.targetAspect}).`),
        layout: z
          .enum(tuple(SPEAKER_VIEW_LAYOUT_SETTINGS))
          .optional()
          .describe(`How the speakers are laid out (default ${D.layout}; one the shape does not draw is snapped).`),
        switch_type: z.enum(tuple(SPEAKER_SWITCH_IDS)).optional().describe(`The switch at each speaker change (default ${D.switchType}).`),
        emphasis: z
          .string()
          .max(40)
          .refine(isClipPackEmphasis, `emphasis is ${EMPHASIS_VALUES}`)
          .optional()
          .describe(`How the speaker talking is emphasised (default ${D.emphasisStyle}): ${EMPHASIS_VALUES}.`),
        framing_source: framingSourceInputShape.framing_source.describe(
          'How the speakers are followed: "auto" (default) follows faces with Speaker Frames while it is available to you, else the even split; ' +
            '"static" splits the frame evenly by speaker; "tracking" follows faces (charged per started block of 1,000 sampled frames; refused 403 ' +
            "where Speaker Frames is not available to you). Faces aren't named after a speaker yet, so a camera shared by several speakers keeps the even split.",
        ),
        review_before_render: z.boolean().optional().describe(`Stop at a proxy preview for review (default ${D.reviewBeforeRender}).`),
        client_request_id: clientRequestIdSchema.optional(),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      const recordings = recordingsPayload(args)
      if ("error" in recordings) return recordings.error
      return dispatchJob(fastify, session, {
        // The descriptor's route, spelled out: the surface checker reads a tool's routes from its literals.
        url: "/v1/speaker-layout",
        label: LABEL,
        formatRefusal: words.refusalText,
        payload: {
          ...recordings.payload,
          ...(args.target_aspect ? { targetAspect: args.target_aspect } : {}),
          ...(args.layout ? { layout: args.layout } : {}),
          ...(args.switch_type ? { switchType: args.switch_type } : {}),
          ...(args.emphasis ? { emphasisStyle: args.emphasis } : {}),
          // Absent is not sent: the route reads it through Speaker Layout's absent default (auto) for this caller.
          ...framingSourcePayload(args),
          ...(args.review_before_render !== undefined ? { reviewBeforeRender: args.review_before_render } : {}),
          // The agent that asked for a review is its reviewer (as on tighten_episode).
          ...(args.review_before_render === true ? { reviewerPresent: true } : {}),
          mcp_client: session.clientName,
          userId: session.userId,
        },
        widgetKind: "video",
        widgetData: { prompt: "(speaker layout)" },
        ...(args.client_request_id ? { clientRequestId: args.client_request_id } : {}),
      })
    },
  )
}

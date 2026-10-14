/**
 * Tighten Episode's request: the wire schema (REST, MCP loopback, SDK, the
 * editor, the backend engine) and the preparation every route shares — probe
 * the recording (what streams it really carries, how long it is), refuse what
 * the chain cannot run, resolve the settings, build the graph. No row, no hold.
 */
import { z } from "zod"
import {
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  TIGHTEN_MAX_EPISODE_SEC,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  type TightenEpisodeSettings,
  type TightenEpisodeSources,
  type UseCaseGraph,
  type UseCaseMediaKind,
} from "@nodaro/render-rules"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import { EDIT_PLAN_TIERS, EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import { safeUrlSchema } from "../url-validator.js"
import { probeMediaDuration, probeMediaStreams } from "../../providers/video/ffmpeg-utils.js"

const tuple = (list: readonly string[]) => list as unknown as [string, ...string[]]

export const tightenEpisodeBody = z.object({
  /** The recording. One in this phase; multicam arrives with the Cameras section. */
  mediaUrls: z.array(safeUrlSchema).min(1).max(1),
  musicUrl: safeUrlSchema.optional(),
  output: z.enum(["video", "audio"]).optional(),
  /**
   * Frame the episode with Speaker View: an output aspect and a layout, on
   * automatic boxes over the speakers on screen. null/absent = no framing. A
   * layout the aspect does not draw is snapped by the settings resolver, as
   * the render would snap it.
   */
  framing: z
    .object({
      aspect: z.enum(tuple(EDL_TARGET_ASPECTS)),
      layout: z.enum(tuple(SPEAKER_VIEW_LAYOUT_SETTINGS)),
    })
    .nullable()
    .optional(),
  captions: z.boolean().optional(),
  captionStyle: z.enum(tuple(ALL_CAPTION_STYLES)).optional(),
  reviewBeforeRender: z.boolean().optional(),
  planTier: z.enum(tuple(EDIT_PLAN_TIERS)).optional(),
  instructions: z.string().max(4000).optional(),
  styleGuide: z.string().max(4000).optional(),
  musicDuckAmount: z.number().min(0).max(100).optional(),
  // Honoured on the internal lane only (the backend engine); ignored from any other caller.
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).max(10).optional(),
  previewStopRule: z.boolean().optional(),
  reviewerPresent: z.boolean().optional(),
  billingContext: z.unknown().optional(),
  // The usual job stamps.
  userId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().max(200).optional(),
  mcp_client: z.string().max(200).optional(),
})
export type TightenEpisodeBody = z.infer<typeof tightenEpisodeBody>

/**
 * POST /v1/tighten-episode/continue: continue a run of yours — from where it
 * failed, or its Render final after a review. The run is named by its wrapper
 * job; the graph is the snapshot that run stored, never one rebuilt here.
 */
export const usecaseContinueBody = z.object({
  jobId: z.string().uuid(),
  mode: z.enum(["from-failed", "render-final"]),
  /** Render final only: the reviewer's edit of the plan, applied by its basis. */
  editedEdl: z.unknown().optional(),
  // Honoured on the internal lane only (the backend engine); ignored from any other caller.
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).max(10).optional(),
  previewStopRule: z.boolean().optional(),
  reviewerPresent: z.boolean().optional(),
  billingContext: z.unknown().optional(),
  // The usual job stamps.
  userId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().max(200).optional(),
  mcp_client: z.string().max(200).optional(),
}).refine((b) => b.mode === "render-final" || b.editedEdl === undefined || b.editedEdl === null, {
  message: "editedEdl applies to a Render final only (mode: \"render-final\")",
  path: ["editedEdl"],
})
export type UseCaseContinueBody = z.infer<typeof usecaseContinueBody>

export type PreparedUseCase =
  | { readonly ok: true; readonly settings: TightenEpisodeSettings; readonly sources: TightenEpisodeSources; readonly graph: UseCaseGraph }
  | { readonly ok: false; readonly status: 400 | 403 | 503; readonly code: string; readonly message: string }

const refuse = (code: string, message: string): PreparedUseCase => ({ ok: false, status: 400, code, message })

/**
 * Whether someone can review this run's preview (decided 2026-10-13) — the
 * one place a use-case route derives it. A caller outside any run reviews
 * their own run: present exactly when they asked for review. Inside another
 * run (the internal lane) only that run's own answer counts, and only a
 * literal `true`.
 */
export function usecaseReviewerPresent(
  settings: Pick<TightenEpisodeSettings, "reviewBeforeRender">,
  lane: { readonly internal: boolean; readonly forwarded: unknown },
): boolean {
  if (!settings.reviewBeforeRender) return false
  return lane.internal ? lane.forwarded === true : true
}

export async function prepareTightenEpisode(body: TightenEpisodeBody, _userId: string): Promise<PreparedUseCase> {
  const mediaUrl = body.mediaUrls[0]!
  let streams: { hasVideo: boolean; hasAudio: boolean }
  try {
    streams = await probeMediaStreams(mediaUrl)
  } catch {
    return refuse("media_unreadable", "The recording could not be read. Check that the link opens and is a video or audio file.")
  }
  if (!streams.hasAudio) return refuse("media_has_no_audio", "The recording has no sound to transcribe.")
  const durationSec = await probeMediaDuration(mediaUrl)
    .then((d) => (Number.isFinite(d) && d > 0 ? d : undefined))
    .catch(() => undefined)
  if (durationSec !== undefined && durationSec > TIGHTEN_MAX_EPISODE_SEC) {
    return refuse("media_too_long", "Tighten Episode takes recordings up to 3 hours.")
  }
  if (body.musicUrl) {
    const music = await probeMediaStreams(body.musicUrl).catch(() => null)
    if (!music?.hasAudio) return refuse("music_has_no_audio", "The music file could not be read as audio.")
  }
  const kind: UseCaseMediaKind = streams.hasVideo ? "video" : "audio"
  const settings = resolveTightenEpisodeSettings(body, kind)
  const sources: TightenEpisodeSources = {
    media: { url: mediaUrl, kind, ...(durationSec !== undefined ? { durationSec } : {}) },
    ...(body.musicUrl ? { music: { url: body.musicUrl } } : {}),
  }
  return { ok: true, settings, sources, graph: buildTightenEpisodeGraph(settings, sources) }
}

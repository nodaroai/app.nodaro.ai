// @registry-lookup asks the body of the one use-case type it is given (USE_CASE_BODIES[type])
/**
 * The podcast pack's request (decided 2026-11-18): the recording once, and
 * the tools to run on it, each with its own settings. Each tool's body is
 * built from the two and parsed by the tool's own schema when it runs, so a
 * tool refuses in the pack exactly what it refuses on its own route.
 */
import { z } from "zod"
import type { UseCaseNodeType } from "@nodaro/render-rules"
import { USE_CASE_BODIES } from "./bodies.js"
import { usecaseMulticamRecordingShape, usecaseSpeakerNamesShape } from "./body-shapes.js"
import { PODCAST_PACK_TOOLS, type PodcastPackTool } from "./pack-price.js"
import { SERVER_ONLY_KEY_PREFIX } from "../server-only-keys.js"

const toolSettings = z.record(z.string(), z.unknown())

export const podcastPackBody = z.object({
  ...usecaseMulticamRecordingShape,
  ...usecaseSpeakerNamesShape,
  /** The tools to run, each with its own settings ({} for its defaults). */
  tools: z
    .object(Object.fromEntries(PODCAST_PACK_TOOLS.map((t) => [t, toolSettings.optional()])) as Record<PodcastPackTool, z.ZodOptional<typeof toolSettings>>)
    .strict()
    .refine((tools) => Object.values(tools).some((v) => v !== undefined), { message: "Choose at least one tool" }),
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().max(200).optional(),
  mcp_client: z.string().max(200).optional(),
  /** Honoured on the internal lane only: a person is at that run to review a tool's preview. */
  reviewerPresent: z.boolean().optional(),
})
export type PodcastPackBody = z.infer<typeof podcastPackBody>

/** The tools a pack's body chooses, in the pack's own order. */
export function packToolsChosen(body: Pick<PodcastPackBody, "tools">): PodcastPackTool[] {
  return PODCAST_PACK_TOOLS.filter((t) => body.tools[t] !== undefined)
}

/**
 * Keys a tool's settings never carry into its body: the recording and the
 * speakers (the pack's own), the lane and stamp keys (the server's), and every
 * server-only key.
 */
const NOT_A_SETTING = new Set([
  "mediaUrls", "masterAudioUrl", "cameras", "speakerNames",
  "componentDepth", "executingComponentIds", "previewStopRule", "reviewerPresent", "billingContext",
  "userId", "workflowId", "nodeId", "mcp_client",
])

const takes = (type: UseCaseNodeType, key: string): boolean => Object.hasOwn(USE_CASE_BODIES[type].shape, key)

/** The body `type` runs on: its own settings, the pack's recording, and the speakers' names where it takes them. */
export function packToolBody(body: PodcastPackBody, type: PodcastPackTool): Record<string, unknown> {
  const own = Object.fromEntries(
    Object.entries(body.tools[type] ?? {}).filter(([key]) => !NOT_A_SETTING.has(key) && !key.startsWith(SERVER_ONLY_KEY_PREFIX)),
  )
  return {
    ...own,
    mediaUrls: body.mediaUrls,
    ...(body.masterAudioUrl !== undefined && takes(type, "masterAudioUrl") ? { masterAudioUrl: body.masterAudioUrl } : {}),
    ...(body.cameras !== undefined && takes(type, "cameras") ? { cameras: body.cameras } : {}),
    ...(body.speakerNames !== undefined && takes(type, "speakerNames") ? { speakerNames: body.speakerNames } : {}),
  }
}

/** The chosen tools whose settings ask to stop for a review before the render. */
export function packToolsReviewing(body: PodcastPackBody): PodcastPackTool[] {
  return packToolsChosen(body).filter((t) => (body.tools[t] as Record<string, unknown> | undefined)?.reviewBeforeRender === true)
}

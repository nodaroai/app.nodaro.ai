/**
 * The request bodies of the use-case routes (decided 2026-10-14): one schema
 * per type, sharing the lane fields every use-case route reads. REST, the MCP
 * loopback, the SDK, the editor and the backend engine all send these.
 */
import { z } from "zod"
import { SPEAKER_VIEW_LAYOUT_SETTINGS, type UseCaseNodeType } from "@nodaro/render-rules"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"
import { EDIT_PLAN_TIERS, EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import { safeUrlSchema } from "../url-validator.js"

const tuple = (list: readonly string[]) => list as unknown as [string, ...string[]]

/** Honoured on the internal lane only (the backend engine); ignored from any other caller. Then the usual job stamps. */
export const usecaseLaneShape = {
  componentDepth: z.number().int().min(0).max(5).optional(),
  executingComponentIds: z.array(z.string()).max(10).optional(),
  previewStopRule: z.boolean().optional(),
  reviewerPresent: z.boolean().optional(),
  billingContext: z.unknown().optional(),
  userId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  nodeId: z.string().max(200).optional(),
  mcp_client: z.string().max(200).optional(),
} satisfies z.ZodRawShape

/** The plan settings every use-case node has. */
const planShape = {
  planTier: z.enum(tuple(EDIT_PLAN_TIERS)).optional(),
  instructions: z.string().max(4000).optional(),
  styleGuide: z.string().max(4000).optional(),
} satisfies z.ZodRawShape

/** The recording. One in this phase; multicam arrives with the Cameras section. */
const recording = { mediaUrls: z.array(safeUrlSchema).min(1).max(1) } satisfies z.ZodRawShape

export const tightenEpisodeBody = z.object({
  ...recording,
  musicUrl: safeUrlSchema.optional(),
  output: z.enum(["video", "audio"]).optional(),
  /**
   * Frame the episode with Speaker View: an output aspect and a layout, on
   * automatic boxes over the speakers on screen. null/absent = no framing. A
   * layout the aspect does not draw is snapped by the settings resolver, as
   * the render would snap it.
   */
  framing: z
    .object({ aspect: z.enum(tuple(EDL_TARGET_ASPECTS)), layout: z.enum(tuple(SPEAKER_VIEW_LAYOUT_SETTINGS)) })
    .nullable()
    .optional(),
  captions: z.boolean().optional(),
  captionStyle: z.enum(tuple(ALL_CAPTION_STYLES)).optional(),
  reviewBeforeRender: z.boolean().optional(),
  ...planShape,
  musicDuckAmount: z.number().min(0).max(100).optional(),
  ...usecaseLaneShape,
})
export type TightenEpisodeBody = z.infer<typeof tightenEpisodeBody>

/** Every type's body; each use-case node adds its own. */
export const USE_CASE_BODIES: { readonly [K in UseCaseNodeType]: z.ZodObject<z.ZodRawShape> } = {
  "tighten-episode": tightenEpisodeBody,
}

/**
 * Whether `type`'s body takes `null` for `key` — a setting whose None is not
 * its default (Tighten's framing). Any other null a node holds (an agent's or
 * an import's write) is left out of a request: the route then takes its default.
 */
export function usecaseBodyTakesNull(type: UseCaseNodeType, key: string): boolean {
  const field = USE_CASE_BODIES[type].shape[key]
  return field !== undefined && z.safeParse(field, null).success
}

/** What every type's parsed body carries (its own settings ride as further keys). */
export type UseCaseBody = {
  mediaUrls: string[]
  musicUrl?: string
  introCardUrl?: string
  reviewBeforeRender?: boolean
  componentDepth?: number
  executingComponentIds?: string[]
  previewStopRule?: boolean
  reviewerPresent?: boolean
  billingContext?: unknown
  userId?: string
  workflowId?: string
  nodeId?: string
  mcp_client?: string
} & Record<string, unknown>

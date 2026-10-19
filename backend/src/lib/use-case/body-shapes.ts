/**
 * The request-body fields every use-case node shares (decided 2026-10-14): the
 * lane fields every use-case route reads, the plan settings and the recording.
 * A use-case node's body spreads these and adds its own settings — a legacy
 * type in bodies.ts, a node unit in its `use-case.ts`.
 *
 * Kept apart from bodies.ts (the composer of the use-case bodies, which a unit
 * may not import — G5), so a unit's `use-case.ts` can import its shapes.
 *
 * A unit's `use-case.ts` is a declaration only (G7): it writes an enum over a
 * list as `z.enum(LIST as unknown as [string, ...string[]])` — a helper call
 * such as `z.enum(tuple(LIST))` is not a pure argument, and G7 refuses it.
 */
import { z } from "zod"
import { USE_CASE_MAX_RECORDINGS } from "@nodaro/render-rules"
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import { safeUrlSchema } from "../url-validator.js"

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
export const usecasePlanShape = {
  planTier: z.enum(EDIT_PLAN_TIERS as unknown as [string, ...string[]]).optional(),
  instructions: z.string().max(4000).optional(),
  styleGuide: z.string().max(4000).optional(),
} satisfies z.ZodRawShape

/** The recording. One in this phase; multicam arrives with the Cameras section. */
export const usecaseRecordingShape = { mediaUrls: z.array(safeUrlSchema).min(1).max(1) } satisfies z.ZodRawShape

/**
 * The Cameras settings (decided 2026-10-17): read only with 2+ recordings or a
 * Master audio; each range is re-checked against the run's real count by the
 * resolver (`resolveUseCaseCameras`). `wide` is a camera position (1-based),
 * `speakerCameras` maps a speaker ordinal ("1" = the first voice heard) to a
 * camera position, 0 for no camera of their own.
 */
export const camerasShape = z.object({
  wide: z.number().int().min(1).max(USE_CASE_MAX_RECORDINGS).nullable().optional(),
  synced: z.boolean().optional(),
  speakerCameras: z.record(
    z.string().regex(/^[1-9]\d*$/).refine((s) => Number(s) <= USE_CASE_MAX_RECORDINGS, { message: `a speaker is 1 to ${USE_CASE_MAX_RECORDINGS}` }),
    z.number().int().min(0).max(USE_CASE_MAX_RECORDINGS),
  ).optional(),
}).strict()

/**
 * The recordings of a multicam-capable node: 1 to USE_CASE_MAX_RECORDINGS
 * recordings, an optional Master audio and the Cameras settings. A node's
 * `use-case.ts` spreads this in place of `usecaseRecordingShape` from its
 * multicam work on; no node does yet, so every body is unchanged.
 * (body-shapes.ts is not a unit module, so it may compute from an import; a
 * unit's `use-case.ts` only spreads these constants.)
 */
export const usecaseMulticamRecordingShape = {
  mediaUrls: z.array(safeUrlSchema).min(1).max(USE_CASE_MAX_RECORDINGS),
  masterAudioUrl: safeUrlSchema.optional(),
  cameras: camerasShape.optional(),
} satisfies z.ZodRawShape

import { z } from "zod"
import type { Operation } from "fast-json-patch"
import type { PipelineStageName } from "./pipeline-events.js"
import { ShowrunnerPlanSchema } from "./pipeline-types.js"

/** RFC 6902 JSON Patch operations. */
export type JsonPatch = Operation[]

/**
 * Response from the chat-refine-showrunner LLM specialist. Either includes a
 * concrete proposed change the user can apply, or none (chat-only reply).
 *
 * Two variants:
 *   - 'edit_artifact': JSON Patch operations to apply to the current stage
 *     artifact (Script stage = ShowrunnerPlan).
 *   - 'suggest_branch': the LLM thinks a deeper change is needed — recommend
 *     the user use the Branch flow (1D.3) from this stage instead of trying
 *     to patch inline.
 */
export const ChatTurnResponseSchema = z.object({
  reply: z.string().min(1).max(4000),
  proposed_change: z
    .discriminatedUnion("change_type", [
      z.object({
        change_type: z.literal("edit_artifact"),
        json_patch: z
          .array(
            z.object({
              op: z.enum(["add", "remove", "replace"]),
              path: z.string().min(1),
              value: z.unknown().optional(),
            }),
          )
          .min(1)
          .max(50),
        summary: z.string().min(1).max(200),
      }),
      z.object({
        change_type: z.literal("suggest_branch"),
        from_stage: z.literal("script"),
        reason: z.string().min(1).max(300),
      }),
    ])
    .nullable(),
})
export type ChatTurnResponse = z.infer<typeof ChatTurnResponseSchema>
export type ProposedChange = NonNullable<ChatTurnResponse["proposed_change"]>

/**
 * Per-stage patch validation schema for `applyStageEdit`. Stages other than
 * `script` don't have chat enabled in 1D.2b (per LLM spec v4.0 narrowing) —
 * their entries are explicitly `null` to keep the type-check exhaustive when
 * future stages are added.
 */
export const STAGE_PATCH_SCHEMA: Record<PipelineStageName, z.ZodTypeAny | null> = {
  script: ShowrunnerPlanSchema,
  characters: null,
  objects: null,
  locations: null,
  shot_list: null,
  scene_images: null,
  animate_audio_edit: null,
  post_merge: null,
}

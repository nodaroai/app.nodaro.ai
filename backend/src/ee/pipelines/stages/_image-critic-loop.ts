import type { SupabaseClient } from "@supabase/supabase-js"
import {
  IMAGE_CRITIC_MAX_RETRIES,
  IMAGE_CRITIC_UNRESOLVABLE,
} from "@nodaro/shared"
import { isBlockingImageCriticFail } from "../llms/_image-critic-shared.js"
import { pipelineEvents } from "../events.js"
import { buildCriticFeedbackPrompt, runCriticRetryLoop } from "../_critic-retry.js"

export type ImageCriticEntityType = "character" | "location"

/**
 * Minimum shape the loop needs to read from any image-critic verdict.
 * Both `CharacterImageCriticVerdict` and `LocationImageCriticVerdict`
 * satisfy this: same field names, same primitives. The `category` enum
 * narrows differently per verdict — kept as `string` here since the loop
 * only uses it for prompt-text interpolation, not branching.
 */
export interface ImageCriticVerdictLike {
  verdict: "pass" | "fail"
  prompt_adherence_score: number
  identified_subject: string
  issues: ReadonlyArray<{
    severity: "blocking" | "warning"
    category: string
    description: string
    suggested_fix: string
  }>
}

export interface RunImageCriticLoopArgs<TVerdict extends ImageCriticVerdictLike> {
  supabase: SupabaseClient
  pipelineId: string
  entity: {
    id: string
    entity_key: string
    metadata: Record<string, unknown> | null
  }
  entityType: ImageCriticEntityType
  basePrompt: string
  initialAsset: { assetId: string | null; assetUrl: string }
  generate: (prompt: string) => Promise<{ assetId: string | null; assetUrl: string }>
  runCritic: (imageUrl: string) => Promise<TVerdict>
  /**
   * Starting retry count. When the orchestrator re-enters
   * `generate{Character,Location}Main` for a rejected entity, the prior
   * `image_critic_retry_count` from metadata flows in so the budget is
   * effectively shared across regeneration attempts. Defaults to 0.
   */
  initialRetryCount?: number
}

export type RunImageCriticLoopResult<TVerdict extends ImageCriticVerdictLike> =
  | {
      ok: true
      assetId: string | null
      assetUrl: string
      retryCount: number
      finalVerdict: TVerdict
    }
  | { ok: false }

/**
 * Shared retry loop for Phase 1D.2c-a image critics. Used by both Stage 2
 * (characters) and Stage 4 (locations). Encapsulates:
 *   - The fail predicate (verdict='fail' OR prompt_adherence_score below threshold)
 *   - The retry budget (IMAGE_CRITIC_MAX_RETRIES)
 *   - The feedback-prompt construction
 *   - The cap-exhausted entity-failure metadata write + SSE
 *
 * Caller responsibilities:
 *   - First image gen (the initial assetUrl is the input; loop starts at iter 1)
 *   - The `generate(prompt)` closure that regenerates on retry
 *   - The `runCritic(imageUrl)` closure that calls the appropriate critic
 *   - On success (`ok: true`): caller proceeds with voice-matcher / metadata write
 *   - On failure (`ok: false`): caller MUST return early; entity is already failed
 */
export async function runImageCriticLoop<TVerdict extends ImageCriticVerdictLike>(
  args: RunImageCriticLoopArgs<TVerdict>,
): Promise<RunImageCriticLoopResult<TVerdict>> {
  // Closure-captured asset refs — the helper's `runAttempt` callback updates
  // these on each retry so the post-loop persistence sees the final pair.
  let assetId = args.initialAsset.assetId
  let assetUrl = args.initialAsset.assetUrl
  const initialVerdict = await args.runCritic(assetUrl)

  const loopResult = await runCriticRetryLoop<TVerdict>({
    initial: initialVerdict,
    maxRetries: IMAGE_CRITIC_MAX_RETRIES,
    isBlockingFail: isBlockingImageCriticFail,
    runAttempt: async (prevVerdict, _attemptNumber) => {
      const blockingIssues = prevVerdict.issues.filter(
        (i) => i.severity === "blocking",
      )
      const feedbackPrompt = buildCriticFeedbackPrompt({
        basePrompt: args.basePrompt,
        identifiedAs: prevVerdict.identified_subject,
        blockingIssues,
        fallbackAdvice: "Improve overall adherence to the visual_description.",
      })
      const regen = await args.generate(feedbackPrompt)
      assetId = regen.assetId
      assetUrl = regen.assetUrl
      return await args.runCritic(assetUrl)
    },
  })

  // The image loop's `initialRetryCount` carries the entity's prior
  // `image_critic_retry_count` from metadata across Regenerate cycles — the
  // shared helper only knows about retries it ran THIS call. Add the delta.
  const retryCount = (args.initialRetryCount ?? 0) + loopResult.retryCount
  const verdict = loopResult.finalVerdict

  if (loopResult.failed) {
    // Cap exhausted — persist failure metadata + emit SSE. Voice-matcher
    // (characters) and the success-path metadata write (both) are
    // intentionally skipped: the entity is unrecoverable for this pass and
    // the user must Regenerate via the EntityCard.
    await args.supabase
      .from("pipeline_entities")
      .update({
        status: "failed",
        metadata: {
          ...(args.entity.metadata ?? {}),
          // Keys mirrored in IMAGE_CRITIC_METADATA_KEYS — see
          // `@nodaro/shared/pipeline-defaults`. Update both writer + clearer
          // (retry-image-generation route) together if you add a key here.
          last_error: IMAGE_CRITIC_UNRESOLVABLE,
          last_error_at: new Date().toISOString(),
          image_critic_retry_count: retryCount,
          critic_findings: verdict.issues,
          last_attempted_image_url: assetUrl,
          // Phase 1D.2c-a /simplify Fix 2 — persist the failed-attempt
          // asset id so the force-approve route can adopt it without an
          // extra `assets`-by-created_at lookup. Older entities (pre-fix)
          // won't have this; the route's fallback handles that case.
          last_attempted_asset_id: assetId,
        },
      })
      .eq("id", args.entity.id)

    pipelineEvents.publish({
      type: "entity:status",
      pipelineId: args.pipelineId,
      entityId: args.entity.id,
      entityType: args.entityType,
      entityKey: args.entity.entity_key,
      status: "failed",
    })

    return { ok: false }
  }

  return { ok: true, assetId, assetUrl, retryCount, finalVerdict: verdict }
}

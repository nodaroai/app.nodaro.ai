import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineConfig, ShowrunnerPlan } from "@nodaro/shared"
import {
  DEFAULT_CHARACTER_ANGLE_COUNT,
  DEFAULT_CHARACTER_EXPRESSION_COUNT,
  SHORT_FILM_VARIANT_THRESHOLD_SEC,
  SHORT_FILM_ANGLE_COUNT,
  SHORT_FILM_EXPRESSION_COUNT,
  resolvePipelineModel,
} from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
import { runVoiceMatcher } from "../llms/voice-matcher.js"
import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import {
  bulkApproveStageEntities,
  type CriticRefundFields,
  detectImageCriticFailures,
  ensureStageRow,
  failPipelineWithCriticReason,
  failStage,
} from "../stage-utils.js"
import {
  transitionEntityNodeAndEmit,
  transitionStageEntityNodesAndEmit,
} from "../depends-on.js"
import { emitDependentStaleEvents } from "../entity-approval.js"
import { runImageCriticLoop } from "./_image-critic-loop.js"
import { settledWithLimit } from "../../../lib/settled-with-limit.js"

/**
 * Phase 1D /simplify perf pass: cap parallel per-entity work at 3 (matches
 * the Match Cut Orchestrator precedent — conservative against provider
 * rate limits + DB FOR UPDATE handles credit reservation atomicity). Each
 * entity's outer try/catch swallows its own failure (metadata.last_error
 * persisted independently), so siblings never cancel.
 */
const ENTITY_CONCURRENCY = 3

export interface RunCharactersStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
  /**
   * Phase 1D.2a §4.1 (G1): when `"auto"`, the stage skips the
   * batch-variant approval gate — it bulk-flips every character entity from
   * `awaiting_approval` → `approved`, batches the matching
   * `pipeline_entity_nodes` rows from `pipeline_owned_awaiting_approval` →
   * `pipeline_owned_approved`, marks the stage row `approved`, emits the
   * `stage:status approved` SSE, and re-enqueues the orchestrator with
   * `reason: "stage_advance"` so the next stage picks up.
   *
   * Defaults to `"manual"` so existing callers (and tests) keep the prior
   * behavior: pause at `awaiting_approval` for user approval.
   */
  mode?: "manual" | "auto" | "guided"
  /** Pipeline `config`; resolved via `resolvePipelineModel(config, "characters_image")`. */
  config?: Partial<PipelineConfig> | null
}

/**
 * Stage 2 (Characters). For each cast member from ShowrunnerPlan:
 *  1. Insert pipeline_entities row (status='pending')
 *  2. Generate main image (and voice match if has_dialogue)
 *  3. Transition to 'awaiting_approval' — pause for user
 *  4. After each user approval, generate angle + expression variants
 *  5. When all entities are approved AND have their variant counts, transition stage to 'awaiting_approval'
 *     for the batch-variants approval gate.
 *
 * This orchestrator is RE-ENTRANT: the engine driver may call runCharactersStage multiple
 * times as the stage progresses. The function is idempotent — it reads current state and
 * advances whatever's not yet done.
 */
export async function runCharactersStage(args: RunCharactersStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args
  const imageOverride = resolvePipelineModel(args.config, "characters_image")

  // 1. Ensure stage row exists.
  const stageId = await ensureStageRow(supabase, pipelineId, "characters", 2)

  // 2. Load ShowrunnerPlan from Stage 1 output AND pipeline row (single select
  // for both). The widened SELECT uses the shared `CriticRefundFields` shape
  // from stage-utils so the auto-mode image-critic aggregator below can call
  // `failPipelineWithCriticReason` without a second round-trip to `pipelines`.
  const { data: pipelineRowRaw } = await supabase
    .from("pipelines")
    .select("user_id, reserved_credits, spent_credits")
    .eq("id", pipelineId)
    .single()
  const pipelineRow = pipelineRowRaw as CriticRefundFields | null

  const { data: scriptStage } = await supabase
    .from("pipeline_stages")
    .select("output")
    .eq("pipeline_id", pipelineId)
    .eq("stage_name", "script")
    .single()
  const plan: ShowrunnerPlan | undefined = (scriptStage?.output as { plan?: ShowrunnerPlan })?.plan
  if (!plan) {
    await failStage(supabase, stageId, "showrunner_plan_missing")
    return
  }

  // 3. Materialize entity rows for each cast member (idempotent).
  for (const cast of plan.cast) {
    await ensureCharacterEntity(supabase, pipelineId, stageId, cast)
  }

  // 3.5. Phase 3 (granular-pipeline-control spec) — auto-mode short-circuits
  // the Step A wizard. New character entities are inserted at
  // `pending_description` so manual/guided pipelines wait for the user's
  // wizard click. Auto mode bulk-flips `pending_description → pending` here
  // BEFORE the entity SELECT below, so the existing parallel-gen flow picks
  // up exactly as before (LLM-generated description → auto-approved →
  // image generated). Per spec: "Auto mode is auto-resolved: backend
  // auto-approves the LLM-generated description and triggers generation
  // immediately." Manual/guided modes skip this and pause at pending_description.
  if (args.mode === "auto") {
    await supabase
      .from("pipeline_entities")
      .update({ status: "pending" })
      .eq("pipeline_id", pipelineId)
      .eq("entity_type", "character")
      .eq("status", "pending_description")
  }

  // 4. Process each entity in turn.
  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata, main_asset_id")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "character")
    .order("created_at", { ascending: true })

  // Phase 1D /simplify perf pass: parallelize per-entity work. Each entity is
  // independent (own image gen, own critic retry loop, own metadata writes),
  // so concurrency is safe. The `anyAwaiting` flag is written-only-true from
  // multiple tasks; JS's single-threaded event loop makes this race-free.
  // Set to true when an entity SUCCEEDS (reaches awaiting_approval) OR FAILS —
  // both cases require user attention (review approval OR manual recovery via
  // the EntityCard Regenerate button). If all pending entities fail (transient
  // KIE outage), without this we'd fall through to step 6 and mark the stage
  // `approved` with 0 successful main assets — downstream Shot List would
  // then run against missing main_asset_id refs.
  //
  // Each task wraps its work in try/catch so a thrown error from one entity
  // (e.g. `pipelineGenerateImage` failure inside `generateCharacterMain`)
  // does NOT cancel siblings — failure metadata has already been persisted
  // by the inner handler before the throw. `failFast=false` on the wrapper
  // is belt-and-suspenders: even if a task escaped its catch, sibling tasks
  // continue. The settled wrapper returns all-fulfilled results because
  // catches consume rejections.
  let anyAwaiting = false
  const tasks = (entities ?? []).map((entity) => async () => {
    try {
      // Phase 3 (granular-pipeline-control) — manual/guided pipelines pause
      // here for the user's Step A click. Auto mode is impossible here
      // because the bulk-flip above already converted pending_description →
      // pending. Set anyAwaiting=true so the post-loop branch hits the
      // "pause for user" return instead of falling through to the
      // variant-batch-gate / stage-approved path.
      if (entity.status === "pending_description") {
        anyAwaiting = true
        return
      }
      // Phase 3 — terminal opt-out. Skipped entities don't get an image, but
      // they also don't BLOCK the stage from advancing once all non-skipped
      // entities are resolved. So just return without setting anyAwaiting;
      // the variant-batch-gate check below filters them out.
      if (entity.status === "skipped") {
        return
      }
      if (entity.status === "approved") {
        // Ensure variants are generated.
        await ensureCharacterVariants(supabase, pipelineId, userId, entity, plan, imageOverride)
        return
      }
      if (entity.status === "awaiting_approval") {
        anyAwaiting = true
        return
      }
      if (entity.status === "rejected") {
        // Rejected with feedback — regenerate main.
        await generateCharacterMain(supabase, pipelineId, stageId, userId, entity, plan, imageOverride)
        anyAwaiting = true
        return
      }
      if (entity.status === "pending" || entity.status === "generating") {
        await generateCharacterMain(supabase, pipelineId, stageId, userId, entity, plan, imageOverride)
        anyAwaiting = true
      }
    } catch (err) {
      // Error isolation: `generateCharacterMain` already persists
      // `metadata.last_error` + emits the `entity:status failed` SSE before
      // re-throwing. We log here so the operator sees per-entity failures
      // in worker logs, then swallow so sibling entities can still finish.
      //
      // Also set `anyAwaiting=true`: a failed entity needs user attention
      // (Regenerate / Skip from the EntityCard) and must NOT be silently
      // skipped by the "all approved → mark stage approved" fall-through
      // below. Without this, an all-fail run (e.g. KIE 503 storm) would
      // leave anyAwaiting=false → allVariantsAwaiting=false → step 6 marks
      // the stage `approved` with zero successful main assets, then
      // downstream Shot List runs against missing refs.
      anyAwaiting = true
      console.error(
        `[characters] entity processing failed for ${entity.entity_key} (pipeline=${pipelineId}):`,
        err instanceof Error ? err.message : String(err),
      )
    }
  })
  await settledWithLimit(tasks, ENTITY_CONCURRENCY, undefined, false)

  // Phase 1D.2c-a §6 (D1): auto-mode aggregates `image_critic_unresolvable`
  // failures. By the time we reach this aggregation point, every entity has
  // reached a terminal state — either `awaiting_approval` (critic passed) or
  // `failed` (critic cap exhausted). If ANY entity carries
  // `metadata.last_error === 'image_critic_unresolvable'`, auto-mode can't
  // safely advance: bulk-approve would push a failed-entity stage into the
  // next stage, where downstream nodes (Shot List, Scene Images) would fail
  // referencing missing main assets. Instead, fail the pipeline here with a
  // typed reason + refund the unspent reservation. Manual/guided modes do
  // NOT aggregate — the failed entity stays visible on its EntityCard so
  // the user can Regenerate (handled by E1).
  if (args.mode === "auto") {
    const failed = detectImageCriticFailures(entities ?? [])
    if (failed.length > 0) {
      // The helper derives userId + refundCredits from `pipelineRow` itself
      // (loaded at the top of the handler) and defaults `outputPatch` to
      // `{ failure_reason }` — no per-caller boilerplate needed.
      await failPipelineWithCriticReason({
        supabase,
        pipelineId,
        failureReason: "characters_image_critic_unresolvable",
        stageName: "characters",
        pipelineRow,
      })
      return
    }
  }

  if (anyAwaiting) {
    // Phase 1D.2a §4.1 (G1): auto-mode short-circuits the FIRST per-entity
    // approval gate — bulk-flip every character entity from
    // `awaiting_approval` → `approved` (plus their canvas nodes) and
    // re-enqueue the orchestrator so the next iteration runs
    // `ensureCharacterVariants` against the approved entities. Manual/guided
    // modes fall through to the existing pause.
    if (args.mode === "auto") {
      await bulkApproveStageEntities(supabase, pipelineId, "character", "characters")
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
      return
    }
    // Pause for user — stage stays 'running'; per-entity awaiting_approval gates surface in panel.
    return
  }

  // 5. All entities approved + variants generated → batch-approval gate for the variants.
  // Re-fetch entities to read latest metadata.variants_awaiting_approval written by
  // ensureCharacterVariants above. The local `entities` snapshot from step 4 is stale —
  // reading from it would miss the variants_awaiting_approval flag and fall through to
  // the "all approved" branch, skipping the batch-variant approval gate entirely.
  const { data: refreshedEntities } = await supabase
    .from("pipeline_entities")
    .select("status, metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "character")
  // Phase 3 — skipped entities are terminal opt-outs; they never have
  // variants, so filter them out of the variant-batch-gate check. If EVERY
  // entity was skipped, nonSkipped.length === 0 → allVariantsAwaiting=false
  // → falls through to step 6 (stage approved) which is correct.
  const nonSkippedEntities = (refreshedEntities ?? []).filter(
    (e) => e.status !== "skipped",
  )

  // If ANY non-skipped entity has a variant-generation failure marker
  // (outermost catch wrote `variant_generation_error`, OR per-variant loop
  // recorded `variants_failed_count > 0`), keep the stage in `running` and
  // exit without re-enqueueing. The EntityCard surfaces a Retry button
  // that hits POST /v1/pipelines/:id/entities/:eid/retry-variants, which
  // clears the markers + re-enqueues. Without this guard the engine falls
  // through to step 6 and marks the stage `approved` even though the
  // failed entities have no variants, then Stage 3 starts referencing
  // missing assets. This is exactly the failure mode pipeline 65c57374
  // hit on 2026-05-26 (3 of 4 characters with no variant rows, stage
  // silently stalled forever).
  const anyVariantFailures = nonSkippedEntities.some((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>
    return (
      typeof meta.variant_generation_error === "string" ||
      (typeof meta.variants_failed_count === "number" && (meta.variants_failed_count as number) > 0)
    )
  })
  if (anyVariantFailures && args.mode !== "auto") {
    // Manual/guided: pause for user retry. SSE event lets any open
    // EntityCard refresh its variant-error state immediately.
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "characters",
      status: "running",
    })
    return
  }

  const allVariantsAwaiting =
    nonSkippedEntities.length > 0 &&
    nonSkippedEntities.every(
      (e) =>
        (e.metadata as Record<string, unknown> | null)?.variants_awaiting_approval === true,
    )
  if (allVariantsAwaiting) {
    // Phase 1D.2a §4.1 (G1): auto-mode short-circuits the batch-variant
    // approval gate — bulk-flip every entity + canvas node to `approved`,
    // mark the stage row `approved`, emit the matching SSE, and re-enqueue
    // the orchestrator for the next stage. Manual/guided modes fall through
    // to the existing `awaiting_approval` pause.
    if (args.mode === "auto") {
      await bulkApproveStageEntities(supabase, pipelineId, "character", "characters")
      await supabase
        .from("pipeline_stages")
        .update({ status: "approved", completed_at: new Date().toISOString() })
        .eq("id", stageId)
      pipelineEvents.publish({
        type: "stage:status",
        pipelineId,
        stageName: "characters",
        status: "approved",
      })
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
      return
    }

    // Manual / guided modes: transition stage to 'awaiting_approval' for the
    // batch variant gate (existing behavior — unchanged).
    await supabase
      .from("pipeline_stages")
      .update({ status: "awaiting_approval", output: { phase: "variant_batch_approval" } })
      .eq("id", stageId)
    // Phase 1B.4 (D1): batch-flip every materialized character canvas node to
    // `awaiting_approval` in a single UPDATE. Per-entity state_change events
    // follow so the UI animates each card individually.
    await transitionStageEntityNodesAndEmit(
      supabase,
      pipelineId,
      "character",
      "pipeline_owned_awaiting_approval",
      "characters",
    )
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "characters",
      status: "awaiting_approval",
    })
    return
  }

  // 6. Variants approved → advance stage.
  await supabase
    .from("pipeline_stages")
    .update({
      status: "approved",
      completed_at: new Date().toISOString(),
    })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "characters",
    status: "approved",
  })
  // Drive the next stage (see objects.ts) — without this re-enqueue the manual
  // completion path marks approved but never advances, stalling the pipeline.
  const { enqueuePipelineRun } = await import("../queue.js")
  await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
}

// ─────────────────────────────────────────────────────────────────────────────

async function ensureCharacterEntity(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  cast: ShowrunnerPlan["cast"][number],
): Promise<void> {
  await supabase
    .from("pipeline_entities")
    .upsert(
      {
        pipeline_id: pipelineId,
        stage_id: stageId,
        entity_type: "character",
        entity_key: cast.key,
        // Phase 3 (granular-pipeline-control spec) — new initial state.
        // Manual/guided pipelines wait here for the user's Step A click
        // (POST /entities/:id/approve-description); auto mode bulk-flips
        // to 'pending' at stage start so the existing parallel-gen flow
        // takes over.
        status: "pending_description",
        metadata: {
          entity_type: "character",
          name: cast.name,
          visual_description: cast.visual_description,
          role: cast.role,
          estimated_screen_time_shots: 0, // filled in Stage 5
          has_dialogue: cast.has_dialogue,
          voice_profile: cast.voice_profile,
          angle_count: cast.angle_count_hint ?? DEFAULT_CHARACTER_ANGLE_COUNT,
        },
      },
      { onConflict: "pipeline_id,entity_type,entity_key", ignoreDuplicates: true },
    )
}

async function generateCharacterMain(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  userId: string,
  entity: { id: string; entity_key: string; metadata: Record<string, unknown> | null },
  plan: ShowrunnerPlan,
  imageOverride?: string,
): Promise<void> {
  const cast = plan.cast.find((c) => c.key === entity.entity_key)
  if (!cast) {
    await supabase
      .from("pipeline_entities")
      .update({ status: "failed" })
      .eq("id", entity.id)
    return
  }
  await supabase
    .from("pipeline_entities")
    .update({ status: "generating" })
    .eq("id", entity.id)
  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId: entity.id,
    entityType: "character",
    entityKey: entity.entity_key,
    status: "generating",
  })

  // Image prompt: visual_description + global style (read from plan).
  const prompt = `${cast.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, portrait, neutral expression, front-facing`

  try {
    const initialAsset = await pipelineGenerateImage({
      supabase,
      pipelineId,
      pipelineEntityId: entity.id,
      userId,
      prompt,
      userOverride: imageOverride,
    })

    // ─────────────────────────────────────────────────────────────────────
    // Phase 1D.2c-a §5 (C1): vision-LLM critic gate + feedback-retry loop.
    // The shared loop helper handles: (1) the fail predicate
    // (verdict='fail' OR prompt_adherence_score < threshold), (2) the retry
    // budget (IMAGE_CRITIC_MAX_RETRIES), (3) feedback-prompt construction,
    // (4) on cap-exhaust → persist failed metadata + emit entity:status
    // SSE. On `ok: false` we return early; voice-matcher is intentionally
    // skipped (entity is unrecoverable; user must regenerate via the
    // EntityCard).
    // ─────────────────────────────────────────────────────────────────────
    const { runCharacterImageCritic } = await import("../llms/character-image-critic.js")
    const loopResult = await runImageCriticLoop({
      supabase,
      pipelineId,
      entity,
      entityType: "character",
      basePrompt: prompt,
      initialAsset,
      initialRetryCount:
        ((entity.metadata as { image_critic_retry_count?: number } | null)
          ?.image_critic_retry_count) ?? 0,
      generate: (feedbackPrompt) =>
        pipelineGenerateImage({
          supabase,
          pipelineId,
          pipelineEntityId: entity.id,
          userId,
          prompt: feedbackPrompt,
          userOverride: imageOverride,
        }),
      runCritic: async (imageUrl) => {
        const result = await runCharacterImageCritic({
          supabase,
          pipelineId,
          stageId,
          userId,
          imageUrl,
          visualDescription: cast.visual_description,
          globalStyle: plan.global_style,
        })
        return result.verdict
      },
    })
    if (!loopResult.ok) return
    const { assetId, assetUrl, retryCount, finalVerdict } = loopResult

    // Voice match if dialogue-bearing. Non-fatal — the actual voice
    // selection isn't consumed until Stage 7 (audio). Failing Stage 2 on a
    // voice-matcher error would lose the just-completed image generation
    // and block the whole pipeline; instead we log the error onto entity
    // metadata for the user/admin to retrigger later and proceed.
    let voiceMatchMeta: unknown = undefined
    let voiceMatchError: string | undefined = undefined
    if (cast.has_dialogue) {
      try {
        voiceMatchMeta = await runVoiceMatcher({
          supabase,
          pipelineId,
          stageId,
          userId,
          castKey: cast.key,
          castName: cast.name,
          visualDescription: cast.visual_description,
          voiceProfile: cast.voice_profile,
        })
      } catch (err) {
        voiceMatchError = err instanceof Error ? err.message : String(err)
        console.error(
          `[characters] voice-matcher failed for ${cast.key} (pipeline=${pipelineId}); proceeding without voice assignment:`,
          voiceMatchError,
        )
      }
    }
    await supabase
      .from("pipeline_entities")
      .update({
        main_asset_id: assetId,
        status: "awaiting_approval",
        metadata: {
          ...(entity.metadata ?? {}),
          voice_match: voiceMatchMeta,
          ...(voiceMatchError ? { voice_match_error: voiceMatchError } : {}),
          // Phase 1D.2c-a §5 (C1): persist informational findings on the
          // success path too, so EntityCard can render warning-severity
          // issues even when verdict='pass'. `undefined` removes the key
          // from the JSONB; zeros / empty arrays would clutter metadata.
          critic_findings:
            finalVerdict.issues.length > 0 ? finalVerdict.issues : undefined,
          image_critic_retry_count: retryCount > 0 ? retryCount : undefined,
        },
      })
      .eq("id", entity.id)
    // Phase 1B.4 (C1): cascade-staleness trigger fires on main_asset_id change.
    await emitDependentStaleEvents(supabase, pipelineId, entity.id)
    // Phase 1B.4 (D1): canvas node → awaiting_approval (no-op when no row yet).
    await transitionEntityNodeAndEmit(
      supabase,
      pipelineId,
      entity.id,
      "pipeline_owned_awaiting_approval",
      "characters",
    )
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "character",
      entityKey: entity.entity_key,
      status: "awaiting_approval",
      mainAssetUrl: assetUrl,
    })
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err)
    console.error(
      `[characters] generateCharacterMain failed for ${entity.entity_key} (pipeline=${pipelineId}):`,
      errMessage,
    )
    await supabase
      .from("pipeline_entities")
      .update({
        status: "failed",
        metadata: {
          ...(entity.metadata ?? {}),
          last_error: errMessage,
          last_error_at: new Date().toISOString(),
        },
      })
      .eq("id", entity.id)
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "character",
      entityKey: entity.entity_key,
      status: "failed",
    })
    throw err
  }
}

/**
 * Metadata keys this function reads/writes. Kept here so the retry route
 * + the EntityCard recovery surface use the exact same key names.
 *   - variants_awaiting_approval: set when every variant for this entity
 *     succeeded. Drives the stage-level awaiting_approval transition.
 *   - variants_failed_count: count of variants whose row ended at
 *     status='failed'. When > 0 the entity needs user attention (retry).
 *   - variants_total_count: total variants attempted this run (for the
 *     "3 of 5 generated" UI surface).
 *   - variant_generation_error: outermost catch — set when the function
 *     itself threw before reaching the per-variant loop (e.g.
 *     `assetUrlForId` SELECT failed, INSERT errored on something other
 *     than `duplicate`). Distinct from per-variant failures.
 *   - variant_generation_error_at: ISO timestamp of the outermost catch.
 */
async function ensureCharacterVariants(
  supabase: SupabaseClient,
  pipelineId: string,
  userId: string,
  entity: {
    id: string
    entity_key: string
    metadata: Record<string, unknown> | null
    main_asset_id: string | null
  },
  plan: ShowrunnerPlan,
  imageOverride?: string,
): Promise<void> {
  const cast = plan.cast.find((c) => c.key === entity.entity_key)
  if (!cast || !entity.main_asset_id) return

  try {
    // Check existing variants.
    const { data: existingVariants } = await supabase
      .from("pipeline_entity_variants")
      .select("variant_key, status")
      .eq("entity_id", entity.id)

    // existingKeys counts only "approved" rows. Rows with status='failed' or
    // 'pending' from a prior partial run should be retried — leaving them in
    // existingKeys would silently skip them and the entity would forever
    // appear "complete enough" without actually having all variants.
    const existingKeys = new Set(
      (existingVariants ?? [])
        .filter((v) => v.status === "approved")
        .map((v) => v.variant_key),
    )

    // Decide what to generate. Short films get a lean reference set — each
    // shot animates from a single reference image (providers drop extras), so
    // a few-shot film can't use 5-8 variants/character. Longer films keep the
    // full plan-driven set: the `Infinity` cap below is a no-op for them, so
    // their behavior is byte-for-byte unchanged.
    const shortFilm =
      (plan.target_duration_seconds ?? Number.POSITIVE_INFINITY) <=
      SHORT_FILM_VARIANT_THRESHOLD_SEC
    const angleCount = Math.min(
      cast.angle_count_hint ?? DEFAULT_CHARACTER_ANGLE_COUNT,
      shortFilm ? SHORT_FILM_ANGLE_COUNT : Number.POSITIVE_INFINITY,
    )
    const maxExpressions = shortFilm
      ? SHORT_FILM_EXPRESSION_COUNT
      : Number.POSITIVE_INFINITY
    const expressionSource: readonly string[] =
      cast.expression_set_hint.length > 0
        ? cast.expression_set_hint
        : (["neutral", "smiling"].slice(0, DEFAULT_CHARACTER_EXPRESSION_COUNT) as readonly string[])
    const expressions: readonly string[] = [...expressionSource].slice(0, maxExpressions)

    // Angle variants (profile, three_quarter, full_body, etc — generic labels).
    const angleLabels = ["profile", "three_quarter", "full_body"].slice(0, Math.max(0, angleCount - 1))
    const variantsToGen: Array<{ key: string; kind: "angle" | "expression"; prompt: string }> = []
    for (const angle of angleLabels) {
      const key = `angle_${angle}`
      if (existingKeys.has(key)) continue
      variantsToGen.push({
        key,
        kind: "angle",
        prompt: `${cast.visual_description}, ${plan.global_style.visual_style}, ${angle} angle, neutral expression`,
      })
    }
    for (const expr of expressions) {
      const key = `expression_${expr}`
      if (existingKeys.has(key)) continue
      variantsToGen.push({
        key,
        kind: "expression",
        prompt: `${cast.visual_description}, ${plan.global_style.visual_style}, ${expr} expression, front-facing`,
      })
    }

    if (variantsToGen.length === 0) {
      // All variants present — mark entity's metadata so the stage knows.
      const meta = stripVariantFailureKeys(entity.metadata)
      await supabase
        .from("pipeline_entities")
        .update({
          variant_count: existingKeys.size,
          metadata: { ...meta, variants_awaiting_approval: true },
        })
        .eq("id", entity.id)
      return
    }

    // Resolve the main reference URL once — every variant uses the same image.
    const mainUrl = entity.main_asset_id
      ? await assetUrlForId(supabase, entity.main_asset_id)
      : ""

    // Per-variant outcome tracking — the post-loop metadata write surfaces
    // partial failures so the user can hit Retry from the EntityCard.
    let failedVariantCount = 0

    // Generate sequentially (cheap parallelism risk: voice/credit reservation could spike).
    for (const v of variantsToGen) {
      // Upsert-like: insert at status='pending', then update to approved/failed.
      // A duplicate-row error means a prior partial run left this variant in
      // the table — overwrite its status by skipping the insert and letting
      // the UPDATE below land.
      const { error: insertErr } = await supabase
        .from("pipeline_entity_variants")
        .insert({
          entity_id: entity.id,
          variant_key: v.key,
          variant_kind: v.kind,
          status: "pending",
        })
      if (insertErr && !insertErr.message.includes("duplicate")) {
        // Hard fail on the INSERT — surface via the outer catch.
        throw insertErr
      }
      try {
        const { assetId, assetUrl } = await pipelineGenerateImage({
          supabase,
          pipelineId,
          pipelineEntityId: entity.id,
          userId,
          prompt: v.prompt,
          referenceImageUrls: mainUrl ? [mainUrl] : undefined,
          userOverride: imageOverride,
        })
        await supabase
          .from("pipeline_entity_variants")
          .update({ asset_id: assetId, status: "approved" })
          .eq("entity_id", entity.id)
          .eq("variant_key", v.key)
        pipelineEvents.publish({
          type: "entity:variant:added",
          pipelineId,
          entityId: entity.id,
          variantKey: v.key,
          assetUrl,
        })
      } catch (err) {
        failedVariantCount += 1
        await supabase
          .from("pipeline_entity_variants")
          .update({ status: "failed" })
          .eq("entity_id", entity.id)
          .eq("variant_key", v.key)
        // Log + continue with other variants — one failed variant shouldn't
        // block the entity from accumulating the others. The post-loop
        // metadata write surfaces the partial-failure count.
        console.error(
          `[characters] Failed to generate variant ${v.key} for ${entity.entity_key}:`,
          err,
        )
      }
    }

    // Post-loop metadata write. THREE cases:
    //   - All succeeded → set variants_awaiting_approval=true and clear any
    //     prior failure flags. Stage advance gate fires.
    //   - All failed → variants_failed_count=N, no awaiting flag. The
    //     engine's post-loop check (below) detects this and stays in running.
    //   - Partial → same as all-failed: surface count, no awaiting flag,
    //     user hits Retry to re-attempt the failed ones.
    const total = variantsToGen.length + existingKeys.size
    const meta = stripVariantFailureKeys(entity.metadata)
    const nextMeta: Record<string, unknown> =
      failedVariantCount === 0
        ? { ...meta, variants_awaiting_approval: true }
        : {
            ...meta,
            variants_failed_count: failedVariantCount,
            variants_total_count: total,
          }
    await supabase
      .from("pipeline_entities")
      .update({ variant_count: total, metadata: nextMeta })
      .eq("id", entity.id)
  } catch (err) {
    // Outermost catch — the function itself threw before reaching the loop
    // (e.g. assetUrlForId SELECT failed, an INSERT errored unexpectedly).
    // Without this, the exception propagates to the stage-handler's outer
    // catch which only sets anyAwaiting=true and logs — the entity ends up
    // approved with NO variants, NO error metadata, and the pipeline stalls
    // forever. This is exactly the bug that produced the user-reported
    // "Stage 2 silently stuck with 3 of 4 characters missing variants" on
    // 2026-05-26 (pipeline 65c57374). Persisting the error here lets the
    // EntityCard surface a Retry button.
    const errMsg = err instanceof Error ? err.message : String(err)
    const meta = stripVariantFailureKeys(entity.metadata)
    await supabase
      .from("pipeline_entities")
      .update({
        metadata: {
          ...meta,
          variant_generation_error: errMsg,
          variant_generation_error_at: new Date().toISOString(),
        },
      })
      .eq("id", entity.id)
    console.error(
      `[characters] ensureCharacterVariants threw for ${entity.entity_key} (pipeline=${pipelineId}):`,
      errMsg,
    )
  }
}

/** Remove the per-run failure markers so a successful retry re-shows as clean. */
function stripVariantFailureKeys(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) }
  delete next.variants_failed_count
  delete next.variants_total_count
  delete next.variant_generation_error
  delete next.variant_generation_error_at
  return next
}

async function assetUrlForId(supabase: SupabaseClient, assetId: string): Promise<string> {
  const { data } = await supabase.from("assets").select("r2_url").eq("id", assetId).single()
  return data?.r2_url ?? ""
}

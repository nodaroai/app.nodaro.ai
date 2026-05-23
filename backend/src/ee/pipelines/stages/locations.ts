import type { SupabaseClient } from "@supabase/supabase-js"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { MAX_LOCATION_VARIANTS } from "@nodaro/shared"
import { pipelineEvents } from "../events.js"
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
 * the characters-stage + Match Cut Orchestrator precedents — conservative
 * against provider rate limits + DB FOR UPDATE handles credit reservation
 * atomicity). Each entity's outer try/catch swallows its own failure, so
 * siblings never cancel.
 */
const ENTITY_CONCURRENCY = 3

export interface RunLocationsStageArgs {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  userTier: string
  /**
   * Phase 1D.2a §4.1 (G3): when `"auto"`, the stage skips BOTH approval
   * gates — the initial per-location main-image gate AND the
   * variant-batch gate. In each case it bulk-flips every location entity
   * (clearing the `variants_awaiting_approval` metadata flag when present
   * for the variant gate), batches the matching `pipeline_entity_nodes`
   * rows from `pipeline_owned_awaiting_approval` → `pipeline_owned_approved`,
   * marks the stage row `approved`, emits the `stage:status approved` SSE,
   * and re-enqueues the orchestrator with `reason: "stage_advance"`.
   *
   * Defaults to `"manual"` so existing callers (and tests) keep the prior
   * two-phase pause behavior.
   */
  mode?: "manual" | "auto" | "guided"
}

/**
 * Stage 4 (Locations). Per-location:
 *  1. Generate MAIN image
 *  2. Await approval
 *  3. Generate variants from variants_needed (capped at MAX_LOCATION_VARIANTS)
 *  4. Batch approve variants
 *
 * Mirrors Stage 2 (Characters) main+variants shape, minus the voice-matcher step
 * and with location-specific variant kinds (time_of_day, weather, aftermath, angle).
 * Re-entrant: the engine driver may call this multiple times as the stage
 * progresses; the function is idempotent — it reads current state and advances
 * whatever's not yet done.
 */
export async function runLocationsStage(args: RunLocationsStageArgs): Promise<void> {
  const { supabase, pipelineId, userId } = args

  const stageId = await ensureStageRow(supabase, pipelineId, "locations", 4)

  // Widened SELECT uses the shared `CriticRefundFields` shape from stage-utils:
  // pulling `user_id` + `reserved_credits` + `spent_credits` inline here lets
  // the auto-mode image-critic aggregator below call
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

  // Materialize entity rows for each location (idempotent).
  for (const loc of plan.locations) {
    await supabase
      .from("pipeline_entities")
      .upsert(
        {
          pipeline_id: pipelineId,
          stage_id: stageId,
          entity_type: "location",
          entity_key: loc.key,
          status: "pending",
          metadata: {
            entity_type: "location",
            name: loc.name,
            visual_description: loc.visual_description,
            variants_needed: loc.variants_needed.slice(0, MAX_LOCATION_VARIANTS),
          },
        },
        { onConflict: "pipeline_id,entity_type,entity_key", ignoreDuplicates: true },
      )
  }

  const { data: entities } = await supabase
    .from("pipeline_entities")
    .select("id, entity_key, status, metadata, main_asset_id")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "location")
    .order("created_at", { ascending: true })

  // Phase 1D /simplify perf pass: parallelize per-entity work. Each entity
  // is independent (own image gen, own critic retry loop, own metadata
  // writes), so concurrency is safe. The `anyAwaiting` flag is
  // written-only-true from multiple tasks; JS's single-threaded event loop
  // makes this race-free. Set to true when an entity SUCCEEDS (reaches
  // awaiting_approval) OR FAILS — both cases require user attention (review
  // approval OR manual recovery via the EntityCard Regenerate button). If
  // all pending entities fail (transient KIE outage), without this we'd
  // fall through to step 6 and mark the stage `approved` with 0 successful
  // main assets — downstream Shot List would then run against missing
  // main_asset_id refs.
  //
  // Each task wraps its work in try/catch so a thrown error from one entity
  // (e.g. `pipelineGenerateImage` failure inside `generateLocationMain`)
  // does NOT cancel siblings — failure metadata has already been persisted
  // by the inner handler before the throw. `failFast=false` on the wrapper
  // is belt-and-suspenders.
  let anyAwaiting = false
  const tasks = (entities ?? []).map((entity) => async () => {
    try {
      if (entity.status === "approved") {
        await ensureLocationVariants(supabase, pipelineId, userId, entity, plan)
        return
      }
      if (entity.status === "awaiting_approval") {
        anyAwaiting = true
        return
      }
      if (
        entity.status === "pending" ||
        entity.status === "generating" ||
        entity.status === "rejected"
      ) {
        await generateLocationMain(supabase, pipelineId, stageId, userId, entity, plan)
        anyAwaiting = true
      }
    } catch (err) {
      // Error isolation: `generateLocationMain` already persists
      // `metadata.last_error` + `last_error_at` + emits the
      // `entity:status failed` SSE before re-throwing (symmetric with
      // characters.ts since Pass 1 c52a756d). We log here so the operator
      // sees per-entity failures in worker logs, then swallow so sibling
      // entities can still finish.
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
        `[locations] entity processing failed for ${entity.entity_key} (pipeline=${pipelineId}):`,
        err instanceof Error ? err.message : String(err),
      )
    }
  })
  await settledWithLimit(tasks, ENTITY_CONCURRENCY, undefined, false)

  // Phase 1D.2c-a §6 (D1): auto-mode aggregates `image_critic_unresolvable`
  // failures. Mirrors the characters-stage check (see characters.ts:105-118
  // for the rationale). If ANY location entity carries
  // `metadata.last_error === 'image_critic_unresolvable'`, fail the pipeline
  // here with a typed reason + refund. Manual/guided modes do NOT aggregate.
  if (args.mode === "auto") {
    const failed = detectImageCriticFailures(entities ?? [])
    if (failed.length > 0) {
      // The helper derives userId + refundCredits from `pipelineRow` itself
      // (loaded at the top of the handler) and defaults `outputPatch` to
      // `{ failure_reason }` — no per-caller boilerplate needed.
      await failPipelineWithCriticReason({
        supabase,
        pipelineId,
        failureReason: "locations_image_critic_unresolvable",
        stageName: "locations",
        pipelineRow,
      })
      return
    }
  }

  if (anyAwaiting) {
    // Phase 1D.2a §4.1 (G3): auto-mode short-circuits the FIRST per-location
    // approval gate — bulk-flip every location entity from
    // `awaiting_approval` → `approved` (plus their canvas nodes) and
    // re-enqueue the orchestrator so the next iteration runs
    // `ensureLocationVariants` against the approved entities. Manual/guided
    // modes fall through to the existing pause.
    if (args.mode === "auto") {
      await bulkApproveStageEntities(supabase, pipelineId, "location", "locations")
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({ pipelineId, userId, reason: "stage_advance" })
      return
    }
    return
  }

  // Re-fetch to read latest metadata.variants_awaiting_approval after variant generation.
  // The local `entities` snapshot above is stale — reading from it would miss the
  // variants_awaiting_approval flag written by ensureLocationVariants and fall through
  // to the "all approved" branch, skipping the batch-variant approval gate entirely.
  // (Section G's stale-snapshot fix applied preemptively here.)
  const { data: refreshedEntities } = await supabase
    .from("pipeline_entities")
    .select("metadata")
    .eq("pipeline_id", pipelineId)
    .eq("entity_type", "location")
  const allVariantsAwaiting =
    (refreshedEntities ?? []).length > 0 &&
    (refreshedEntities ?? []).every(
      (e) =>
        (e.metadata as Record<string, unknown> | null)?.variants_awaiting_approval === true,
    )
  if (allVariantsAwaiting) {
    // Phase 1D.2a §4.1 (G3): auto-mode short-circuits the variant-batch
    // approval gate — bulk-flip every entity + canvas node to `approved`
    // (clearing the `variants_awaiting_approval` metadata flag so the gate
    // never re-triggers on a future re-entry), mark the stage row
    // `approved`, emit the matching SSE, and re-enqueue the orchestrator
    // for the next stage. Manual/guided modes fall through to the existing
    // `awaiting_approval` pause.
    if (args.mode === "auto") {
      // Re-fetch entity ids+metadata so we can clear the
      // `variants_awaiting_approval` flag per-row while preserving the
      // surrounding metadata blob.
      const { data: locEntities } = await supabase
        .from("pipeline_entities")
        .select("id, metadata")
        .eq("pipeline_id", pipelineId)
        .eq("entity_type", "location")
      for (const ent of locEntities ?? []) {
        const meta = (ent.metadata as Record<string, unknown> | null) ?? {}
        const cleared = { ...meta }
        delete cleared.variants_awaiting_approval
        await supabase
          .from("pipeline_entities")
          .update({ status: "approved", metadata: cleared })
          .eq("id", ent.id as string)
      }
      await transitionStageEntityNodesAndEmit(
        supabase,
        pipelineId,
        "location",
        "pipeline_owned_approved",
        "locations",
      )
      await supabase
        .from("pipeline_stages")
        .update({ status: "approved", completed_at: new Date().toISOString() })
        .eq("id", stageId)
      pipelineEvents.publish({
        type: "stage:status",
        pipelineId,
        stageName: "locations",
        status: "approved",
      })
      const { enqueuePipelineRun } = await import("../queue.js")
      await enqueuePipelineRun({
        pipelineId,
        userId,
        reason: "stage_advance",
      })
      return
    }

    await supabase
      .from("pipeline_stages")
      .update({ status: "awaiting_approval", output: { phase: "variant_batch_approval" } })
      .eq("id", stageId)
    // Phase 1B.4 (D1): batch-flip every materialized location canvas node to
    // `awaiting_approval` in a single UPDATE (cheaper than N per-entity calls).
    // Then emit one state_change event per touched entity so the UI can animate
    // each card. Entities with no materialized node yet are skipped gracefully.
    await transitionStageEntityNodesAndEmit(
      supabase,
      pipelineId,
      "location",
      "pipeline_owned_awaiting_approval",
      "locations",
    )
    pipelineEvents.publish({
      type: "stage:status",
      pipelineId,
      stageName: "locations",
      status: "awaiting_approval",
    })
    return
  }

  await supabase
    .from("pipeline_stages")
    .update({ status: "approved", completed_at: new Date().toISOString() })
    .eq("id", stageId)
  pipelineEvents.publish({
    type: "stage:status",
    pipelineId,
    stageName: "locations",
    status: "approved",
  })
}

// ─────────────────────────────────────────────────────────────────────────────

async function generateLocationMain(
  supabase: SupabaseClient,
  pipelineId: string,
  stageId: string,
  userId: string,
  entity: { id: string; entity_key: string; metadata: Record<string, unknown> | null },
  plan: ShowrunnerPlan,
): Promise<void> {
  const loc = plan.locations.find((l) => l.key === entity.entity_key)
  if (!loc) return

  await supabase
    .from("pipeline_entities")
    .update({ status: "generating" })
    .eq("id", entity.id)
  pipelineEvents.publish({
    type: "entity:status",
    pipelineId,
    entityId: entity.id,
    entityType: "location",
    entityKey: entity.entity_key,
    status: "generating",
  })

  const prompt = `${loc.visual_description}, ${plan.global_style.visual_style}, ${plan.global_style.lighting}, wide establishing shot, no people`

  try {
    const initialAsset = await pipelineGenerateImage({
      supabase,
      pipelineId,
      pipelineEntityId: entity.id,
      userId,
      prompt,
    })

    // ─────────────────────────────────────────────────────────────────────
    // Phase 1D.2c-a §5 (C2): vision-LLM critic gate + feedback-retry loop.
    // Shares the same loop helper used by Stage 2 (characters); see
    // _image-critic-loop.ts for the canonical implementation. On
    // `ok: false` the helper has already persisted failed metadata + emitted
    // the entity:status SSE, so we return early.
    // ─────────────────────────────────────────────────────────────────────
    const { runLocationImageCritic } = await import("../llms/location-image-critic.js")
    const loopResult = await runImageCriticLoop({
      supabase,
      pipelineId,
      entity,
      entityType: "location",
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
        }),
      runCritic: async (imageUrl) => {
        const result = await runLocationImageCritic({
          supabase,
          pipelineId,
          stageId,
          userId,
          imageUrl,
          visualDescription: loc.visual_description,
          globalStyle: plan.global_style,
        })
        return result.verdict
      },
    })
    if (!loopResult.ok) return
    const { assetId, assetUrl, retryCount, finalVerdict } = loopResult

    await supabase
      .from("pipeline_entities")
      .update({
        main_asset_id: assetId,
        status: "awaiting_approval",
        metadata: {
          ...(entity.metadata ?? {}),
          // Phase 1D.2c-a §5 (C2): persist informational findings on the
          // success path so EntityCard can render warning-severity issues
          // even when verdict='pass'. `undefined` removes the key from the
          // JSONB; zeros / empty arrays would clutter metadata.
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
      "locations",
    )
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "location",
      entityKey: entity.entity_key,
      status: "awaiting_approval",
      mainAssetUrl: assetUrl,
    })
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err)
    console.error(
      `[locations] generateLocationMain failed for ${entity.entity_key} (pipeline=${pipelineId}):`,
      errMessage,
    )
    await supabase
      .from("pipeline_entities")
      .update({
        status: "failed",
        metadata: {
          ...((entity.metadata as Record<string, unknown> | null) ?? {}),
          last_error: errMessage,
          last_error_at: new Date().toISOString(),
        },
      })
      .eq("id", entity.id)
    pipelineEvents.publish({
      type: "entity:status",
      pipelineId,
      entityId: entity.id,
      entityType: "location",
      entityKey: entity.entity_key,
      status: "failed",
    })
    throw err
  }
}

async function ensureLocationVariants(
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
): Promise<void> {
  const loc = plan.locations.find((l) => l.key === entity.entity_key)
  if (!loc || !entity.main_asset_id) return

  const variantsNeeded = loc.variants_needed.slice(0, MAX_LOCATION_VARIANTS)
  if (variantsNeeded.length === 0) {
    // No variants requested — mark ready.
    await supabase
      .from("pipeline_entities")
      .update({
        metadata: { ...(entity.metadata ?? {}), variants_awaiting_approval: true },
      })
      .eq("id", entity.id)
    return
  }

  const { data: existing } = await supabase
    .from("pipeline_entity_variants")
    .select("variant_key")
    .eq("entity_id", entity.id)
  const existingKeys = new Set((existing ?? []).map((v) => v.variant_key))

  // Resolve the main reference URL once — every variant uses the same image.
  const mainUrl = await assetUrlForId(supabase, entity.main_asset_id)

  for (const variant of variantsNeeded) {
    if (existingKeys.has(variant)) continue
    const kind =
      variant.includes("sun") ||
      variant.includes("night") ||
      variant.includes("dawn") ||
      variant.includes("dusk")
        ? "time_of_day"
        : variant.includes("storm") || variant.includes("rain") || variant.includes("snow")
          ? "weather"
          : variant.includes("aftermath") ||
              variant.includes("ruined") ||
              variant.includes("destroyed")
            ? "aftermath"
            : "angle"

    await supabase.from("pipeline_entity_variants").insert({
      entity_id: entity.id,
      variant_key: variant,
      variant_kind: kind,
      status: "pending",
    })
    try {
      const prompt = `${loc.visual_description}, ${variant}, ${plan.global_style.visual_style}, wide shot, no people`
      const { assetId, assetUrl } = await pipelineGenerateImage({
        supabase,
        pipelineId,
        pipelineEntityId: entity.id,
        userId,
        prompt,
        referenceImageUrls: [mainUrl],
      })
      await supabase
        .from("pipeline_entity_variants")
        .update({ asset_id: assetId, status: "approved" })
        .eq("entity_id", entity.id)
        .eq("variant_key", variant)
      pipelineEvents.publish({
        type: "entity:variant:added",
        pipelineId,
        entityId: entity.id,
        variantKey: variant,
        assetUrl,
      })
    } catch (err) {
      await supabase
        .from("pipeline_entity_variants")
        .update({ status: "failed" })
        .eq("entity_id", entity.id)
        .eq("variant_key", variant)
      // Log + continue with other variants — one failed variant shouldn't block the entity.
      console.error(
        `[locations] Failed to generate variant ${variant} for ${entity.entity_key}:`,
        err,
      )
    }
  }

  await supabase
    .from("pipeline_entities")
    .update({
      variant_count: variantsNeeded.length,
      metadata: { ...(entity.metadata ?? {}), variants_awaiting_approval: true },
    })
    .eq("id", entity.id)
}

async function assetUrlForId(supabase: SupabaseClient, assetId: string): Promise<string> {
  const { data } = await supabase.from("assets").select("r2_url").eq("id", assetId).single()
  return data?.r2_url ?? ""
}

import type { SupabaseClient } from "@supabase/supabase-js"
import { pollForAssetId, pollJobUntilComplete } from "./_poll.js"

/**
 * Args for the generic pipeline service-wrapper. Every wrapper
 * (pipelineGenerateImage, pipelineAnimateShot, pipelineGenerateSpeech,
 * pipelineLipSync, pipelineCombineVideos, pipelineExtractFrame) maps onto
 * this same 5-step shape: insert `jobs` row tagged `pipeline_id` → reserve
 * credits → enqueue the worker → poll for completion → extract URL +
 * (optionally) link the resulting asset row to the entity.
 *
 * The wrapper-specific parts (input_data shape, queue name, payload to the
 * worker, how the output URL is read from `jobs.output_data`) are passed
 * in as configuration. Everything else is identical across the 6 wrappers.
 */
export interface RunPipelineWorkerJobArgs {
  supabase: SupabaseClient
  pipelineId: string
  /** Optional entity to attribute the resulting asset row to. When set, the
   *  asset row's `pipeline_entity_id` is filled AFTER the worker writes it,
   *  so the DB trigger can cascade `pipeline_id` onto the asset. */
  pipelineEntityId?: string
  userId: string
  /** Shape stored on `jobs.input_data`. Wrapper-specific; mirrors the per-route
   *  body shape so admin/billing/cleanup paths see the same payload they would
   *  for a single-node request. */
  inputData: Record<string, unknown>
  /** BullMQ queue (currently always `videoQueue` but kept as a hook for the
   *  rare future case where a wrapper enqueues onto a different queue). */
  queueName: string
  /** Job name passed to `queue.add(jobName, payload)` — the worker's switch
   *  key (e.g., "generate-image", "image-to-video", "lip-sync"). */
  jobName: string
  /** Flat payload the worker handler destructures. Should contain `jobId` +
   *  `usageLogId` plus whatever the handler expects. Built by the wrapper. */
  buildPayload: (jobId: string, usageLogId: string) => Record<string, unknown>
  /** Credit identifier passed to `CreditsService.reserveCredits` — typically
   *  built via `buildCreditModelIdentifier()` / `buildVideoCreditModelIdentifier()`
   *  / `buildLipSyncCreditId()` for variable-priced models, or a static string
   *  like "extract-frame" / "combine-videos" for fixed-price ones. */
  modelIdentifier: string
  /** Asset type written by the worker's `createAssetFromJob` call. Used to
   *  scope the `pollForAssetId` lookup. */
  assetType: "image" | "video" | "audio"
  /** Reads the output URL out of `jobs.output_data`. Wrappers vary in the
   *  field name: image-gen uses `imageUrl`, video uses `videoUrl`/`url`,
   *  extract-frame uses `imageUrl`/`frameUrl`, etc. */
  pickOutputUrl: (output: Record<string, unknown>) => string | undefined
  /** Error message for the "completed without output URL" case. Wrappers
   *  vary in phrasing — e.g. "Image job completed without imageUrl in
   *  output_data" vs "combine-videos job completed without videoUrl in
   *  output_data". Passed verbatim so existing tests don't churn. */
  missingOutputError: string
}

export interface RunPipelineWorkerJobResult {
  jobId: string
  /** Asset id from `assets` table — null only in the rare race window where
   *  the asset row hasn't landed within the post-completion grace period. */
  assetId: string | null
  /** Output URL extracted from `jobs.output_data` via `pickOutputUrl`. */
  assetUrl: string
  /** Actual credits committed by the worker; falls back to 0 if commit hasn't
   *  caught up by the time we observe status=completed. */
  creditsSpent: number
}

/**
 * Generic pipeline service-wrapper. Implements the 5-step shape every
 * `pipelineXxx` wrapper repeats. Wrappers call this with their per-call
 * specifics (input_data, queue name, payload, credit identifier, output
 * reader, asset type).
 */
export async function runPipelineWorkerJob(
  args: RunPipelineWorkerJobArgs,
): Promise<RunPipelineWorkerJobResult> {
  const {
    supabase,
    pipelineId,
    pipelineEntityId,
    userId,
    inputData,
    queueName,
    jobName,
    buildPayload,
    modelIdentifier,
    assetType,
    pickOutputUrl,
    missingOutputError,
  } = args

  // 1. Create jobs row tagged with pipeline_id so admin/billing/cleanup paths
  //    can correlate this child job back to its parent pipeline.
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      user_id: userId,
      status: "pending",
      input_data: inputData,
      pipeline_id: pipelineId,
    })
    .select("id")
    .single()
  if (insertErr || !job?.id) {
    throw new Error(
      `Failed to create ${jobName} job: ${insertErr?.message ?? "no id returned"}`,
    )
  }
  const jobId = job.id as string

  // 2. Reserve credits via the canonical service. Worker commits/refunds the
  //    real cost on its own — we don't double-commit here.
  const { CreditsService } = await import("../../billing/credits.js")
  const reservation = await CreditsService.reserveCredits(
    userId,
    jobId,
    modelIdentifier,
    0,
    0,
    { isAppRun: false },
  )

  // 3. Enqueue with the flat payload shape the worker handler destructures.
  const { videoQueue } = await import("../../../lib/queue.js")
  if (queueName !== "videoQueue") {
    throw new Error(`Unsupported queue: ${queueName}`)
  }
  await videoQueue.add(jobName, buildPayload(jobId, reservation.usageLogId))

  // 4. Poll the jobs row until terminal.
  const row = await pollJobUntilComplete(supabase, jobId)
  const output = (row.output_data ?? {}) as Record<string, unknown>
  const url = pickOutputUrl(output)
  if (!url) {
    throw new Error(missingOutputError)
  }

  // 5. Optionally link the asset to the entity (DB trigger fills pipeline_id).
  //    The asset row is inserted by `createAssetFromJob` AFTER the handler
  //    resolves, so we poll briefly to give it time to land.
  const assetId = await pollForAssetId(supabase, jobId, assetType)
  if (assetId && pipelineEntityId) {
    await supabase
      .from("assets")
      .update({ pipeline_entity_id: pipelineEntityId })
      .eq("id", assetId)
  }

  return {
    jobId,
    assetId,
    assetUrl: url,
    creditsSpent: row.credits_actual ?? 0,
  }
}

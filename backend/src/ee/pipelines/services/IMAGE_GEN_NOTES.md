# pipelineGenerateImage — investigation notes (Task D1)

Verified call-shape against the existing image-gen path before writing the helper. The plan's D2 stub was approximately right but several specifics diverged from reality.

## Existing image-gen contract (verified from code, not specs)

1. **Route**: `backend/src/routes/generate-image.ts` POSTs to `/v1/generate-image`. It uses the `creditGuard` preHandler + `reserveCreditsForJob` middleware, then INSERTs into `jobs` and ENQUEUEs onto `videoQueue` ("video-generation" queue).

2. **Queue + worker**: `videoQueue` (BullMQ "video-generation" queue) → `backend/src/workers/video-worker.ts` dispatches by `job.name` to `imageAIHandlers["generate-image"]` (`backend/src/workers/handlers/image-ai.ts`). The handler reads `job.data` for prompt/provider/refs, runs the provider, then calls `markJobCompleted(jobId, { output_data: { imageUrl: r2Url, ... } })`.

3. **Queue payload shape** the worker reads (from `handleGenerateImage`'s destructuring of `job.data`):
   ```ts
   {
     jobId: string
     prompt: string
     referenceImageUrls?: string[]
     provider?: string         // not modelIdentifier; "nano-banana" default
     aspectRatio?: string
     resolution?: string
     quality?: string
     negativePrompt?: string
     seed?: number
     renderingSpeed?: string
     styleType?: string
     expandPrompt?: boolean
     usageLogId?: string       // reservation handle for commit
   }
   ```
   NOT a wrapped `{type, input}` shape. The plan's `{ jobId, userId, type: "generate-image", input: {...} }` guess is wrong; the real shape is flat.

4. **Jobs INSERT shape** (from the route, lines 151-162):
   ```ts
   { workflow_id, force_private, user_id, status: "pending",
     input_data: { ...buildJobInputData(parsed.data, "generate-image"), prompt },
     mcp_client? }
   ```
   No `type` column on jobs (job_type is set later by the worker). No `pipeline_id` column reference here — but we have one (migration 121 ALTER TABLE jobs).

5. **CreditsService.reserveCredits signature** (`backend/src/ee/billing/credits.ts:1032`):
   ```ts
   static async reserveCredits(
     userId: string,
     jobId: string,
     modelIdentifier: string,
     providerCostUsd: number,
     displayCostUsd: number,
     options?: { watermarkOverride?: boolean; isAppRun?: boolean; creditOverride?: number },
   ): Promise<ReserveResult>  // { usageLogId, creditsReserved, watermark }
   ```
   It is POSITIONAL, not an object. The plan's `{ userId, jobId, modelIdentifier, providerCostUsd, displayCostUsd, isAppRun }` object-shape guess is wrong. ReserveResult fields: `usageLogId`, `creditsReserved`, `watermark` (not `creditsReserved`+`watermark`+anomalies).

6. **Worker completion**: `output_data` shape is `{ imageUrl: <r2_url>, kieTaskId?, seed?, fallbackUsed?, providerMs? }`. There is NO `asset_id` / `asset_url` field on `output_data` — the plan was wrong about that.

7. **Failure column**: `jobs.error_message` (NOT `jobs.error`). Worker writes `{ status: "failed", error_message, completed_at }`. Refund handled by `refundJobCredits` reading `usageLogId`.

8. **Credits column**: `jobs.credits_actual` (set by `commitJobCredits` post-success). NOT `jobs.credits_used`.

9. **Asset row**: Written by `createAssetFromJob` in `backend/src/workers/shared.ts:447-510` AFTER the handler resolves. The asset's `r2_url` mirrors `output_data.imageUrl`. There IS a brief window where `status=completed` but no asset row exists (handler returned but `createAssetFromJob` still pending or failed silently). For pipeline integration we need to either (a) tolerate a missing asset row in the result, or (b) poll the assets table by job_id with a short bonus deadline.

10. **Pipeline link**: The asset trigger `set_pipeline_id_from_entity` (migration 121:283-299) auto-fills `assets.pipeline_id` when we UPDATE `assets.pipeline_entity_id`. So the post-completion link step is just `UPDATE assets SET pipeline_entity_id = <e> WHERE job_id = <j>` — the trigger handles `pipeline_id` for us.

## Chosen approach (revised from plan)

Strategy (b) from the plan: build payload + manual enqueue + poll. But adapt to reality:

- **Reserve credits** via `CreditsService.reserveCredits(userId, jobId, modelIdentifier, 0, 0)` — POSITIONAL args. We pass `providerCost=0`/`displayCost=0` because the worker computes the real cost from the provider result and `commitJobCredits` overwrites with `actualCredits`. This matches the existing route's pattern: `reserveCreditsForJob` ultimately calls `reserveCredits` and the worker commits with actual cost.

- **Insert jobs row** with `{user_id, status:"pending", input_data, pipeline_id}` — no `type` column. The worker reads its type from BullMQ `job.name`, not from the row.

- **Enqueue** `videoQueue.add("generate-image", {jobId, prompt, referenceImageUrls, provider, aspectRatio, usageLogId})` — flat payload mirroring the route's exact call, plus we MUST pass `usageLogId` so the worker can commit/refund.

- **Poll** `jobs.select("status, output_data, error_message, credits_actual, progress")` every 3s. On `completed`: read `output_data.imageUrl`. On `failed`: throw with `error_message`.

- **Link to entity + fetch asset id**: After completion, `UPDATE assets SET pipeline_entity_id WHERE job_id = jobId`. The trigger sets `pipeline_id`. Then SELECT the asset row by job_id to return its `assetId` (with a short bonus poll loop for the race window where `createAssetFromJob` is still in flight).

- **Result shape**: `{ jobId, assetId, assetUrl, creditsSpent }` — `assetUrl` from `output_data.imageUrl` (the URL the worker uploaded to R2), `assetId` from the `assets` row, `creditsSpent` from `jobs.credits_actual` (this is the post-commit actual; may be the reserved amount until commit lands).

## Why not call the existing route handler?

The plan considered (c) "internal fetch to /v1/generate-image". Rejected because (i) it would need to mint a service-role bearer or carry a user JWT, both messy from inside a worker; (ii) it duplicates Zod validation on data we already control; (iii) we want to tag the job with `pipeline_id` directly, which the route doesn't accept.

## Files touched in D2

- Create: `backend/src/ee/pipelines/services/pipeline-generate-image.ts`
- Create: `backend/src/ee/pipelines/services/__tests__/pipeline-generate-image.test.ts`

No changes to existing image-gen route, worker, or credits service — we reuse them as-is.

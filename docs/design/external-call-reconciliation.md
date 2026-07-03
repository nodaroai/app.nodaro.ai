# External-Call Reconciliation — Design

**Date:** 2026-05-19
**Triggering scenario:** A job (KIE nano-banana-pro 2K image gen) stuck in `processing` at 92% for 10+ hours after worker process recycled mid-poll. KIE-side generation succeeded; our DB row was never updated. Credits still reserved.

---

## 1. Problem

Every long-running external provider call (KIE.ai, Replicate, ElevenLabs, Anthropic) follows the same pattern: a Node.js worker process owns an in-memory poll loop or stream. If that process dies (deploy, OOM, Railway container recycle, BullMQ stall past `lockDuration: 900_000`), there are no surviving artifacts to recover from:

1. The upstream **task identifier is never persisted** to the `jobs` row — it lives only inside the provider client's stack frame.
2. There is **no reconciliation cron** for general jobs. Only `reconcileOrphanedTrainings` (Character LoRA, Replicate-specific) and `sweepStaleVoiceJobs` (suno-voice-create) exist.
3. BullMQ's stalled-job retry (default `maxStalledCount: 1`) re-runs the handler, which calls `createTask` **again** — creating a fresh upstream task and orphaning the original. This causes duplicate billing.

Failure modes observed:
- **Stuck `processing`** (this job's case): worker dies → `maxStalledCount` hit → BullMQ marks its job failed without invoking our `try/catch` → DB row frozen forever.
- **Marked `failed` but upstream succeeded**: stall retry creates new upstream task → if the retry trips, our DB marks the job failed while the *original* upstream task still has a completed result we never collect.
- **Double-billing on long polls**: poll budget (~18min for KIE standard) > BullMQ lock (15min) → two workers run in parallel, both calling `createTask`.

## 2. Goals & non-goals

### Goals
- Persist enough state on every `jobs` row to recover or sweep any inflight external call.
- Make BullMQ stall-retries idempotent against the upstream (no duplicate `createTask`).
- Recover upstream-completed results without user re-run, for async providers (KIE, Replicate, async ElevenLabs).
- Mark failed + refund credits for sync providers (Anthropic, ElevenLabs TTS) where recovery is impossible.
- Unify the existing Character-LoRA reconciliation pattern into the new system (one pattern, not two).

### Non-goals
- Changing BullMQ `lockDuration` / `maxStalledCount` — orthogonal tuning.
- Webhook-based completion (Replicate already has one for LoRA; this design keeps it as the happy path with reconciliation as the safety net).
- Recovering from upstream provider data loss — if KIE itself purges a task, we mark failed + refund.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Single set of columns on `jobs`, not a side table | Every job has at most one external call; reconciliation hot path is a single `WHERE` on a partial index. |
| D2 | Sync providers with no taskId past threshold: mark failed + refund | Aligns with credit-leak prevention. No recovery possible regardless. |
| D3 | Migrate LoRA reconciliation into the new system in Phase 3 | One pattern. `provider_kind='replicate-training'` handled identically to other Replicate paths. |
| D4 | Ship Phase 2 (sync-sweep) before Phase 3 (recovery) | Credit leak is the bigger immediate problem. Phase 3 lands within a week. |
| D5 | Reconciliation is the *safety net*; webhooks (where supported) remain the happy path | Replicate LoRA webhook keeps firing; cron only catches webhook-delivery failures. |
| D6 | Extract `finalizeJobWithMedia` so worker handlers AND reconciliation cron share the post-success path | Avoids duplicate completion logic + drift. |
| D7 | Do NOT add `usage_log_id` column to `jobs`; reconciliation looks it up via `usage_logs WHERE job_id=? AND status='reserved'` | Mirrors existing `refundReservedCreditsForJob` / `commitReservedCreditsForJob` pattern in `lib/credits-job-lifecycle.ts`. CAS on `status='reserved'` is already idempotent. Avoids denormalization. |
| D8 | `provider_call_started_at` is a NEW column distinct from `started_at` | `started_at` = worker dequeued the BullMQ job (set by `render-worker` + `video-worker`); `provider_call_started_at` = the upstream API call was initiated. The latter is what reconciliation thresholds compare against; the former exists for stats. |
| D9 | Sync HTTP routes that call `llmComplete`/`llmStream` set `provider_kind='anthropic-sync'` (or `kie-llm` per routing) + `provider_call_started_at` directly on the job row before invoking the LLM | These 8 routes (ai-writer / video-composer / after-effects / lottie-overlay / 3d-title / motion-graphics / image-to-text + ai-writer SSE variant) create job rows inside the request handler, not via a BullMQ worker, so there is no `onTaskCreated` callback path. Direct UPDATE is the simplest plumbing. |

## 4. Schema

```sql
-- Migration 135 — External-call reconciliation (jobs-table columns + inflight-index)
--
-- Five new columns track external provider tasks so a cron can find stuck rows and
-- either recover them (async, with provider_task_id) or sweep them (sync, no task_id).
***REDACTED-OSS-SCRUB***
--
-- Decision references:
--   D1: Single set of columns on `jobs`, not a side table (every job has ≤ 1 external call).
--   D8: `provider_call_started_at` distinct from `started_at` (set once at API call;
--       NOT re-written on BullMQ stall-retry, so threshold math is stable).
--   D9: Sync HTTP routes (ai-writer, video-composer, etc.) set these directly;
--       async workers set via onTaskCreated callback.
--
-- Index `jobs_inflight_idx` covers BOTH 'pending' and 'processing' states so a
-- route-handler crash before the `pending → processing` flip still surfaces the row.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS provider_kind            text,
  ADD COLUMN IF NOT EXISTS provider_task_id         text,
  ADD COLUMN IF NOT EXISTS provider_call_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_attempts       int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconcile_last_error     text;

CREATE INDEX IF NOT EXISTS jobs_inflight_idx
  ON jobs (provider_call_started_at)
  WHERE status IN ('pending', 'processing');
```

The migration is metadata-only on Postgres 11+ (default Supabase version) — `ADD COLUMN ... NOT NULL DEFAULT 0` does not rewrite the table. Linter rules (`backend/src/__tests__/migration-linter.test.ts`): all three pass (`IF NOT EXISTS` everywhere; no profiles-RLS recursion; no `model_pricing` insert).

Index covers `pending` too: sync-HTTP routes (§5.8) set `provider_kind` + `provider_call_started_at` while the row is still `pending` (the route handler updates to `processing` only inside the LLM call's `try` block, or sometimes skips that transition entirely). Without `pending` in the index predicate, a route-handler crash before the `processing` flip leaves an invisible stuck row.

`provider_kind` is a free-form text validated only by app code (no enum type) — keeps schema migrations cheap when we add a new provider variant. Known values at launch:

| Value | Upstream | Sync/Async | Recovery | Stale threshold |
|---|---|---|---|---|
| `kie-standard` | KIE `/jobs/recordInfo` poll | Async | Yes (mediaUrls) | 10 min |
| `kie-veo` | KIE `/veo/record-info` poll | Async | Yes (mediaUrls) | 25 min |
| `kie-suno` | KIE Suno endpoints | Async | Yes (audio) | 30 min |
| `kie-kontext` | KIE Flux Kontext | Async | Yes | 10 min |
| `kie-luma` | KIE Luma Modify | Async | Yes | 25 min |
| `kie-kling3` | KIE Kling 3.0 `getTaskDetail` | Async | Yes | 25 min |
| `kie-runway` | KIE Runway record-detail | Async | Yes | 25 min |
| `kie-lip-sync` | KIE long lip-sync poll | Async | Yes | 75 min |
| `kie-llm` | KIE-proxied Claude/Gemini/GPT `messages`/`chat-completions` | **Sync** (single HTTP roundtrip via `lib/llm-client.ts`, not a polled task) | No — sweep + fail | 5 min |
| `replicate-prediction` | Replicate `/v1/predictions/:id` | Async | Yes | 20 min |
| `replicate-training` | Replicate `/v1/trainings/:id` | Async | Yes — replaces existing LoRA cron | 30 min |
| `elevenlabs-async` | ElevenLabs voice-clone / voice-design / dubbing / forced-alignment | Async | Yes | 15 min |
| `elevenlabs-sync` | ElevenLabs TTS / SFX / STT (`direct-tts.ts`) | Sync | No — sweep + fail | 5 min |
| `anthropic-sync` | Direct Anthropic SDK (`llm-client.ts::callAnthropicDirect`) | Sync | No — sweep + fail | 5 min |

`reconcile_attempts` + `reconcile_last_error` give us observability and an upper bound on retries (cap at 18 attempts ≈ 90 min at 5-min cron cadence — covers the longest legitimate stale threshold `kie-lip-sync=75min` with 15-min headroom; after that, force-fail + refund).

### 4.1 `started_at` vs `provider_call_started_at` (per D8)

| Column | Set by | Semantics |
|---|---|---|
| `started_at` | `video-worker.ts:104`, `render-worker.ts:786` | Worker dequeued the BullMQ job. Used for stats + progress estimation (`upsertExecutionStats`). Not stable for reconciliation: a BullMQ stall-retry re-runs the handler, which re-writes `started_at`. |
| `provider_call_started_at` (new) | `onTaskCreated` callback for async; direct UPDATE for sync HTTP routes (see §5.8) | When we actually hit the upstream API. Set exactly once per call. Reconciliation threshold compares against this. |

Both columns coexist. We do NOT overwrite `started_at` semantics.

## 5. Architecture

```
                ┌──────────────────────────────────────┐
                │     backend/src/lib/reconcile/        │
                │   ┌────────────────────────────────┐ │
                │   │  cron.ts (entrypoint, */5 min)  │ │
                │   └─────────────┬──────────────────┘ │
                │                 │                     │
                │   dispatch by provider_kind →         │
                │   ┌────────────┐ ┌────────────┐      │
                │   │  kie.ts    │ │ replicate  │      │
                │   ├────────────┤ ├────────────┤      │
                │   │elevenlabs  │ │ sync-sweep │      │
                │   └────┬───────┘ └─────┬──────┘      │
                │        │               │             │
                │        ▼               ▼             │
                │   ┌─────────────────────────────┐   │
                │   │  job-finalize.ts            │   │
                │   │  finalizeJobWithMedia(...)  │   │
                │   │  → markFailed + refund      │   │
                │   └─────────────────────────────┘   │
                └──────────────────────────────────────┘
                              ▲
                              │ shares with
                              │
                ┌─────────────┴────────────────────────┐
                │  backend/src/workers/handlers/*       │
                │  (image-ai, video-ai, audio-ai, ...)  │
                └──────────────────────────────────────┘
```

### 5.1 Provider client split

Each provider client gains a clean `create / poll` split:

```ts
// backend/src/providers/kie/client.ts
export async function createKieTask(model: string, input: ...): Promise<{ taskId: string }>
export async function pollKieTask(taskId: string, opts?: {maxAttempts, onProgress}): Promise<KieResult>
export async function runKieTask(...): Promise<KieResult> {
  const { taskId } = await createKieTask(...)
  await opts?.onTaskCreated?.(taskId)
  return pollKieTask(taskId, ...)
}
```

Same shape for `runVeoTask`, `runKling3Task`, `runRunwayRecordDetail`, `runReplicatePrediction`, ElevenLabs async clients. Existing call sites continue to use `runX` (one-line: create → onTaskCreated → poll).

### 5.2 Persistence callback

Worker handlers pass `onTaskCreated` to every provider call:

```ts
// shared helper
function makeOnTaskCreated(jobId: string, kind: string) {
  return async (taskId: string) => {
    await supabase.from("jobs").update({
      provider_kind: kind,
      provider_task_id: taskId,
      provider_call_started_at: new Date().toISOString(),
    }).eq("id", jobId)
  }
}

// in handleGenerateImage:
result = await generateImage(prompt, model, refs, params, {
  onTaskCreated: makeOnTaskCreated(ctx.jobId, "kie-standard"),
})
```

For **sync providers**, the handler writes `provider_kind` + `provider_call_started_at` directly (no `provider_task_id`) right before the call, so the sync-sweep cron can find stuck rows.

### 5.3 BullMQ retry guard (Phase 4)

Every worker handler, before the provider call, reads `provider_task_id` from the job row:

```ts
const { data: existing } = await supabase
  .from("jobs")
  .select("provider_kind, provider_task_id")
  .eq("id", ctx.jobId)
  .single()

if (existing?.provider_task_id) {
  // Stall-retry: resume the same upstream task. Don't recreate.
  result = await resumeKieTask(existing.provider_task_id, existing.provider_kind)
} else {
  result = await generateImage(..., { onTaskCreated: ... })
}
```

`resumeKieTask` is a thin wrapper that dispatches by `provider_kind` to the right `pollX(taskId)`.

### 5.4 `finalizeJobWithMedia`

```ts
// backend/src/lib/job-finalize.ts
export async function finalizeJobWithMedia(
  jobId: string,
  result: ProviderResult,            // url + extraUrls + cost + providerUsed + ...
  opts: { source: "worker" | "reconcile"; jobType: string }
): Promise<{ ok: boolean }> {
  // 1. Load job row (user_id, should_watermark, is_public, job_type, mcp_client, status).
  //    If status !== 'pending' | 'processing' → bail (already terminal).
  // 2. Look up usage_log_id (per D7): SELECT id FROM usage_logs WHERE job_id=? AND status='reserved' LIMIT 1.
  //    If no reserved log: credits already committed/refunded — proceed without commit.
  // 3. Upload media → R2 via the right helper per jobType
  //    (uploadImageVariantsMaybeWatermark / uploadVideoMaybeWatermark / uploadAudioToR2).
  //    Idempotent: R2 key is deterministic per jobId (e.g., `images/{jobId}.png`).
  //    A duplicate S3 PutObject to the same key atomically overwrites — there is
  //    no partial-write exposure and no version conflict. Safe under worker+cron
  //    race or webhook+cron race.
  // 4. CAS-guarded `markJobCompleted(jobId, fields)`:
  //      UPDATE jobs SET status='completed', output_data=..., provider=, provider_cost=, display_cost=
  //      WHERE id=? AND status != 'cancelled'
  //      .select('id')           -- returns [] iff someone else won the race
  //    If 0 rows → return { ok: false } (another writer landed first; skip steps 5-6).
  // 5. commitJobCredits(usageLogId, jobId, result.cost)
  //    Internally CAS on usage_logs.status='reserved' (already idempotent today).
  // 6. createAssetFromJob(jobId, jobUserId) — same as worker path today.
  // 7. setJobProgress(100) — emits to execution-events bus for orchestrator/widget pickup.
}
```

CAS guard at step 4 means the worker and the reconciliation cron can race on the same job — whichever's `UPDATE ... WHERE status != 'cancelled'` lands first wins; the other gets 0 rows and returns `{ ok: false }`. No locks needed.

Per audit-finding: the existing `markJobCompleted` in `workers/shared.ts:185` already implements this CAS pattern with `.select("id")` to verify the update happened. `finalizeJobWithMedia` reuses it verbatim.

### 5.5 Reconciliation cron

```ts
// backend/src/lib/reconcile/cron.ts
const THRESHOLDS: Record<string, number> = { /* per table in §4 */ }
// 18 attempts × 5-min cadence ≈ 90 min — covers `kie-lip-sync` 75-min threshold
// with 15-min headroom for a legitimately-long upstream call to finish before
// reconcile force-fails. Audit pass #2 finding #5: 12 attempts (≈60 min) was
// too tight for lip-sync; jobs hitting attempt 18 are presumed stuck, not slow.
const MAX_ATTEMPTS = 18

export async function reconcileInflightJobs(): Promise<ReconcileResult> {
  // Note: NO usage_log_id in this select — that column doesn't exist on jobs (D7).
  // Each per-kind handler looks it up via usage_logs WHERE job_id=? AND status='reserved'
  // only at the moment it needs to commit/refund.
  const candidates = await supabase
    .from("jobs")
    .select("id, status, provider_kind, provider_task_id, provider_call_started_at, reconcile_attempts, user_id, job_type, should_watermark, is_public, input_data")
    .in("status", ["pending", "processing"])     // both states — see §4 + §7 edge case
    .not("provider_kind", "is", null)
    .lt("provider_call_started_at", maxThresholdCutoff())  // pre-filter; per-kind refinement below
    .limit(50)

  for (const row of candidates) {
    // Per-kind threshold check (can't go in the SQL WHERE without a CASE expression).
    if (!isStale(row)) continue
    const handler = HANDLERS[row.provider_kind]
    if (!handler) {
      // Unknown kind — fall through to sync-sweep (§5.6 catch-all).
      await syncSweepHandler.reconcile(row)
      continue
    }
    try {
      await handler.reconcile(row)
    } catch (err) {
      await bumpAttempts(row.id, err)
      if (row.reconcile_attempts + 1 >= MAX_ATTEMPTS) {
        await forceFailAndRefund(row, "reconcile_exhausted")
      }
    }
  }
}
```

Per-kind handler interface:

```ts
interface ReconcileHandler {
  reconcile(row: JobRow): Promise<void>
}
// kie.ts:
//   - GET recordInfo
//   - state="success": download → finalizeJobWithMedia
//   - state="fail":    markFailed + refund
//   - state="generating": bump attempts, leave alone
```

### 5.6 Sync-sweep handler

For `provider_kind` ∈ {`anthropic-sync`, `elevenlabs-sync`, `kie-llm`} OR any job with `provider_task_id IS NULL` that's past threshold: mark failed with `error_message='reconcile_no_recovery'`, refund via `refundReservedCreditsForJob(jobId)` (already CAS-guarded on `usage_logs.status='reserved'`).

This is also the catch-all for jobs created **before** Phase 1 ships (no `provider_kind` set). Per D2: mark failed + refund.

**What sync-sweep actually catches** (per audit clarification):

Sync calls themselves succeed or fail inside one Fastify request — they don't "get stuck mid-call" the way async polls can. The realistic stuck-row sources for sync routes are:

1. **Route handler crashed AFTER the LLM call returned but BEFORE the `markJobCompleted` UPDATE** (network blip on Supabase, process killed, OOM during R2 upload of LLM result, etc.).
2. **Post-LLM processing failed** (e.g., ai-writer creating downstream image nodes, JSON parse error on LLM output, validation failure).
3. **Phase 1 didn't yet set `provider_kind`** on this job (legacy stuck rows from before the new code shipped).

For cases 1+2: the LLM was already invoked and we paid the upstream cost, but we can't recover the result — it lived in the route handler's memory. The user re-runs. Refunding our credits is the right call.

For case 3: covered by the "or any job with `provider_task_id IS NULL` past threshold" fallback.

### 5.7 Orchestrator timeout vs reconcile-completion (audit pass #2, finding #4)

**The problem.** The orchestrator polls `jobs.status` every 3s with `NODE_TIMEOUT_MS = 30 min`. If the underlying upstream call legitimately takes longer (`kie-lip-sync` is the canonical example — `MAX_POLL_ATTEMPTS_LIP_SYNC_LONG × pollDelay` ≈ 60 min; user-triggered LoRA training can hit 30+ min), the orchestrator times out, calls `cancelJobAndThrow`, marks the workflow node failed and the parent `workflow_executions` row `failed`.

If the upstream eventually does succeed and either (a) the worker's poll loop catches it, or (b) reconcile recovers it via `finalizeJobWithMedia` — the `jobs` row goes `processing → completed` and the asset lands in the user's library. **But the `workflow_executions` row stays `failed`.** The orchestrator stopped polling. The frontend shows the user a failed workflow even though the output exists.

**Two-part fix in Phase 3:**

1. **Extend `NODE_TIMEOUT_MS` from 30 min to 90 min.** This is the primary fix. Covers every legitimate poll budget in the codebase today:
   - `kie-lip-sync` (≈60 min) — full coverage + 30-min headroom
   - Character LoRA training (15-30 min typical; outliers up to 60 min) — full coverage
   - VEO 4K upscale (5-10 min; outliers occasionally longer) — full coverage
   - Everything else (kie-standard, kie-video, Replicate prediction): far below 90 min already

   `WORKFLOW_TIMEOUT_MS = 60 min` is a separate workflow-level circuit-breaker — leave it. Workflows that legitimately need >60 min are rare and accept the constraint today.

2. **`finalizeJobWithMedia` patches `workflow_executions` on the back-channel.** When reconcile (or a late-arriving worker poll) completes a `jobs` row that has `workflow_execution_id`, the function checks the parent execution. If the parent is in `failed` state AND its `failed_nodes` array contains *only* this job's node id (i.e., the workflow failed solely because of this node's timeout), reopen it:

   ```ts
   // step 8, after createAssetFromJob:
   if (job.workflow_execution_id) {
     const { data: exec } = await supabase
       .from("workflow_executions")
       .select("status, failed_nodes")
       .eq("id", job.workflow_execution_id).single()
     if (exec?.status === "failed" &&
         exec.failed_nodes?.length === 1 &&
         exec.failed_nodes[0] === job.node_id) {
       // Sole-cause failure — recovery is unambiguous; reopen as completed.
       await supabase
         .from("workflow_executions")
         .update({ status: "completed", failed_nodes: [], error_message: null })
         .eq("id", job.workflow_execution_id)
         .eq("status", "failed")          // CAS — don't overwrite a user cancel
     }
     // Multi-failure case: leave the execution failed. User re-runs; recovered
     // output sits in the gallery as standalone media.
   }
   ```

   The CAS-on-`failed` guard mirrors the existing `.neq("status", "cancelled")` pattern.

**Why not just always update?** A workflow that failed for multiple reasons isn't unambiguously recoverable from completing one node — other failed nodes may have dependents that never ran. Treating sole-cause failures as recoverable is a safe, conservative win; multi-cause failures stay failed and require user re-run.

**Phase 3 also adds `failed_nodes` semantics if not already present.** The orchestrator already tracks per-node failure state in `nodeStates`; the audit confirmed `workflow_executions.failed_nodes` exists (see `orchestrator-worker.ts:1051` reference). If the column doesn't exist, the migration adds it as `jsonb` or `text[]`.

### 5.8 Sync-HTTP route persistence (Phase 1 scope addition)

The 8 sync-HTTP routes do NOT go through `onTaskCreated`. They write `provider_kind` + `provider_call_started_at` directly on the existing `jobs` row, right before the LLM call. Per D9.

```ts
// helper used by every sync-HTTP route:
async function markProviderCallStart(jobId: string, kind: string) {
  await supabase
    .from("jobs")
    .update({
      provider_kind: kind,
      provider_call_started_at: new Date().toISOString(),
      // do NOT touch status here — credit-guard's flow already set it.
    })
    .eq("id", jobId)
}
```

The 8 routes that need the call (file:line of their `jobs` INSERT block — call `markProviderCallStart` immediately AFTER `reserveCreditsForJob` returns, BEFORE the `await llmComplete(...)`):

| Route | File | Job INSERT line | provider_kind |
|---|---|---|---|
| ai-writer (sync) | `routes/ai-writer.ts` | ~70-80 | `anthropic-sync` if `directFallbackModel` set, else `kie-llm` (resolve via the same routing flag that `llm-client.ts` uses internally) |
| ai-writer (SSE) | `routes/ai-writer.ts` | ~194-204 | same routing as above |
| video-composer | `routes/scene-graph-ai.ts` | ~70-86 | same |
| after-effects | `routes/after-effects-ai.ts` | ~72-88 | same |
| lottie-overlay | `routes/lottie-overlay-ai.ts` | ~77-93 | same |
| 3d-title | `routes/three-d-title-ai.ts` | ~80-96 | same |
| motion-graphics | `routes/motion-graphics-ai.ts` | ~78-94 | same |
| image-to-text | `routes/image-to-text.ts` | ~71-87 | same |

Cleaner alternative considered + rejected: routing this through the `llm-client.ts` layer (which already knows the routing decision) would be DRYer but requires threading `jobId` into every `llmComplete` / `llmStream` call — bigger blast radius, and the LLM client is shared with non-job code paths (prompt-helper inline calls, MCP server). Direct route-level write is cheaper.

## 6. Phasing

| Phase | PR | Scope | Reviewable in |
|---|---|---|---|
| 1 | `feat(reconcile): persist external task IDs + provider_kind on jobs` | Migration 135 (5 new columns + `jobs_inflight_idx` covering `pending` ∪ `processing`). Split every provider client into `createX` / `pollX` / `runX` wrappers (no behavior change yet). Plumb `onTaskCreated` callback through every worker handler that calls a provider client. Add `markProviderCallStart` to the 8 sync-HTTP routes (§5.8). No reconciliation cron yet — purely instrumentation. | half-day |
| 2 | `feat(reconcile): sync-sweep cron` | `lib/reconcile/cron.ts` entrypoint + `sync-sweep.ts` only, mark-failed-and-refund for stale rows. Catches `provider_task_id IS NULL` (covers all sync routes + legacy pre-Phase-1 stuck rows) AND `provider_kind ∈ {*-sync, kie-llm}`. **Stops the credit leak immediately.** | half-day |
| 3 | `feat(reconcile): per-provider async recovery + finalizeJobWithMedia + orchestrator timeout` | Per-kind reconcile handlers in `lib/reconcile/`: `kie.ts`, `replicate.ts`, `elevenlabs.ts`. Extract `lib/job-finalize.ts::finalizeJobWithMedia` from existing worker handlers (refactor `image-ai`, `video-ai`, `audio-ai`, `suno` to call it). Migrate `reconcileOrphanedTrainings` into the new `replicate.ts` handler under `provider_kind='replicate-training'`; delete the old standalone cron after one cohort verified. **Per §5.7:** extend `NODE_TIMEOUT_MS` from 30→90 min and add sole-cause `workflow_executions` reopen step inside `finalizeJobWithMedia`. **Actually recovers KIE-succeeded jobs without user re-run AND restores the workflow row so the user sees completion in the UI.** | 1-2 days |
| 4 | `feat(reconcile): idempotent BullMQ retry guard` | Worker handler reads `jobs.provider_task_id` before calling the provider. If set: dispatch to `resumeX(taskId)` via `provider_kind`. If not: normal flow with `onTaskCreated`. **Kills duplicate-billing on BullMQ stall-retries.** | half-day |

Phase 1 is the prerequisite for 2/3/4. Phase 2 is independent of 3/4. Phase 4 depends on Phase 3 (uses `resumeX(taskId)` wrappers created by Phase 3's per-provider modules). Each phase ships independently to `dev` → `main` via standard merge flow.

## 7. Edge cases

- **Sub-workflow + workflow-execution jobs**: orchestrator polls `jobs.status`. Reconcile-completes update the row to `completed`; orchestrator's next poll picks it up naturally. No extra wiring needed.
- **Credit refund pool routing**: `usage_logs.metadata.from_sub` + `from_topup` already drive `refundJobCredits`. Reconcile reuses it.
- **Watermarking**: `jobs.should_watermark` captured at credit-reservation time. `finalizeJobWithMedia` reads it from the row, not from the user's current tier — preserves the existing anti-bypass invariant (see backend CLAUDE.md "C4 fix").
- **`is_public` decision**: same — captured on the row at reservation time. `finalizeJobWithMedia` honors it.
- **MCP-origin private gating**: today this is decided inside the worker (`workflow_executions.mcp_client` check). `finalizeJobWithMedia` reads `jobs.is_public` which was already set to `false` by the worker before the call. **If `is_public` is null on the row at reconcile time** (worker died before any writes that set it), default to `true`. This matches the free-tier baseline (Free/Basic tiers cannot opt out; `public_outputs=true` is the default). Defaulting to `false` would surprise the user — their generation should land in the gallery the same as any other free-tier output. Note: paid-tier users who opted into private mode had their `is_public=false` written by `creditGuard` BEFORE the worker started, so reconcile reading the row preserves their setting; the null-default-true case only applies to the rare crash-before-creditGuard-write window, where the tier was still effectively free-tier-equivalent at the moment of failure.
- **Replicate LoRA migration**: existing `reconcileOrphanedTrainings` cron deleted in Phase 3 after the new path has been verified on one cohort of trainings.
- **Webhook racing reconcile**: Replicate LoRA webhook still fires. Both webhook handler and reconcile cron go through CAS-guarded `finalizeJobWithMedia` → at-most-once completion.
- **`reconcile_attempts ≥ 18`**: force-fail + refund + log to `credit_anomalies` for admin review.
- **VEO / Runway / Wan-V2V `kieTaskId` already returned today**: their `ProviderResult.kieTaskId` is used by extend/upscale operations downstream. This design keeps that — Phase 1 simply *also* persists it to the `jobs` row column. No conflict.
- **`usage_log_id` is NOT on `jobs`** (per D7 + audit): the reconciliation cron looks it up via `SELECT id FROM usage_logs WHERE job_id=? AND status='reserved' LIMIT 1`. If no reserved log is found, credits are already terminal (committed or refunded) — the cron skips the commit/refund step and only does the row state transition. This mirrors how `refundReservedCreditsForJob` and `commitReservedCreditsForJob` in `lib/credits-job-lifecycle.ts` already work.
- **`force_private` + `should_watermark` set AFTER job INSERT** (audit-found): the `creditGuard` middleware writes them in a follow-up UPDATE *after* the route creates the row. There is a brief window where these fields are null. In that window the worker hasn't yet started, so the job is not stuck — the cron's threshold-based filter excludes it. Once the worker is running, these fields are populated. `finalizeJobWithMedia` defaults `is_public=false` if null (private — safer; matches the existing MCP-origin gate).
- **`started_at` overwrites on BullMQ stall-retry** (per D8): when BullMQ re-invokes the handler, `video-worker.ts:104` re-writes `started_at`. This is why the reconciliation threshold compares against `provider_call_started_at` (set exactly once via `onTaskCreated`) and not `started_at`.
- **Sync routes with no `processing` flip** (audit-found): some sync HTTP routes never explicitly UPDATE `status='processing'` — they go `pending → completed` (or `pending → failed`). The `jobs_inflight_idx` predicate covers both states (`status IN ('pending','processing')`) so the cron finds these rows. Without this, a pending row from a route handler that crashed before its first DB write would be invisible.
- **KIE LLM is not async** (audit-correction): `kie-llm` represents the `lib/llm-client.ts` path that proxies Claude/Gemini/GPT via KIE — it is a single HTTP roundtrip, not a polled task. There is no taskId to persist; sync-sweep is the only recovery. The provider_kind exists in the schema purely for observability (so the admin can tell apart sync-stuck-from-Anthropic-direct vs sync-stuck-from-KIE-proxied).
- **Upstream signed-URL TTL vs reconcile latency** (audit pass #2, finding #2): provider result URLs are signed and time-bounded. If reconcile picks up a stuck job after the upstream URL has expired, `uploadToR2 → safeFetch(sourceUrl)` returns 403/404, the per-kind handler throws, `reconcile_attempts` increments, and after `MAX_ATTEMPTS=18` the job force-fails + refunds. This is the intended behavior — we never wanted to silently lose result data, but if KIE has already aged it out we can only refund and let the user re-run. **Invariant for threshold tuning:** for any `provider_kind`, the stale threshold MUST be ≤ the upstream's signed-URL TTL minus a buffer (target: half the TTL). KIE today serves result URLs with hours-of-validity TTLs per their docs, so the current 5-75 min thresholds are well within bounds. **Action item before Phase 3 lands:** confirm KIE's mediaUrl TTL is ≥ 90 min; if it's tighter, lower the lip-sync threshold accordingly. Replicate prediction URLs are valid 1 hour after completion — well above the 20-min threshold.
- **MAX_ATTEMPTS=18, not 12** (audit pass #2, finding #5): the per-job retry cap is 18 attempts × 5-min cron cadence ≈ 90 min. Picked so the longest legitimate threshold (`kie-lip-sync` 75 min) has 15-min headroom for the upstream to complete before force-fail. See §5.5 inline comment.

## 8. Test plan

### Phase 1
- Migration test: column add + index create idempotent.
- Provider client unit tests: `runKieTask`/`runVeoTask`/`runReplicatePrediction`/etc. each call `onTaskCreated` exactly once with the right taskId, BEFORE the poll loop starts (mock fetch).
- Handler integration test (one per category — image-ai / video-ai / audio-ai / suno): after a successful generation, the job row has `provider_kind` + `provider_task_id` + `provider_call_started_at` populated.
- Sync-route test (one per route — pick `ai-writer`): job row has `provider_kind='anthropic-sync'` (or `kie-llm` depending on routing) + `provider_call_started_at` set, `provider_task_id=null`, before `llmComplete` is invoked.
- Provider-client backward-compat: existing call sites that used `runKieTask` without `onTaskCreated` still work (callback is optional).

### Phase 2
- Cron test: a `processing` job older than 5 min with `provider_kind='anthropic-sync'` and null `provider_task_id` gets marked failed + refunded after one cron tick.
- Cron test: a `pending` job older than 5 min with `provider_kind='kie-llm'` AND no `usage_log_id` available (credits already refunded) — still gets marked failed (no double-refund).
- Cron test: a job with `provider_kind=null` (legacy pre-Phase-1) past 5 min is also swept — fallback path.
- Negative: a job within threshold is left alone.
- Negative: a job with `status='completed'` or `'cancelled'` is left alone (CAS guard).
- Idempotency: running the cron twice produces the same final state.
- Refund correctness: refunded credits land in the correct pool (sub/topup) per `usage_logs.metadata.from_sub`/`from_topup`.

### Phase 3
- KIE happy path: mock `recordInfo` returning `state="success"` → reconcile finds the row, downloads media, calls `finalizeJobWithMedia`, job goes `processing` → `completed`, R2 upload triggered, credits committed, asset row created in `assets`, orchestrator polling pickup verified.
- KIE failed path: `state="fail"` → `markJobFailed` + `refundReservedCreditsForJob`.
- KIE still-processing path: `state="generating"` → row left alone, `reconcile_attempts` bumped by 1.
- VEO happy path: mock `record-info` returning `successFlag=1` → recovery via `finalizeJobWithMedia`.
- Replicate-prediction happy path: mock `/v1/predictions/:id` returning `status="succeeded"` → recovery.
- Replicate-training migration: kick a training, kill the webhook listener, run cron — char status transitions identically to existing LoRA reconciliation. Old `reconcileOrphanedTrainings` no longer running.
- ElevenLabs voice-clone async recovery: mock voice-clone endpoint, recover.
- Race test: simulate worker + cron both reaching `finalizeJobWithMedia` for the same jobId within the same second. Second writer's `markJobCompleted` returns `{ ok: false }` (0 rows). No duplicate R2 upload (R2 dedupe key includes jobId). No duplicate `commitJobCredits` (CAS on `usage_logs.status='reserved'`).
- `reconcile_attempts ≥ 18`: force-fail + refund + anomaly log.
- Refactor regression: every existing worker handler test still passes after `finalizeJobWithMedia` extraction. No behavior change in the happy path.
- **Workflow-execution reopen (§5.7):** create a `workflow_executions` row in `failed` state with `failed_nodes=[X]`. Reconcile-complete a single job belonging to node X. Assert the workflow row flips to `completed` with `failed_nodes=[]`. CAS-test: same setup but with a user cancel in between — workflow row stays `cancelled`, not flipped back.
- **Multi-failure workflow-execution stays failed:** create workflow_executions in `failed` with `failed_nodes=[X, Y]`. Reconcile-complete job for X. Assert workflow stays `failed` (because Y wasn't recovered). Recovered output for X still lands in the user's library as a standalone asset.
- **NODE_TIMEOUT_MS=90 min:** existing orchestrator timeout test extended — assert 30-min and 60-min poll loops still succeed (lip-sync within budget); 89-min poll succeeds; 91-min poll triggers timeout cancellation.
- **Upstream URL expiration:** mock `safeFetch` to return 403 for `KIE mediaUrl`. Reconcile bumps `reconcile_attempts` correctly, doesn't false-complete the row. At attempt 18, force-fails + refunds.

### Phase 4
- Stalled-retry test: simulate BullMQ re-invoking the handler on a job that already has `provider_task_id` populated. Assert that the create-task fetch is NOT called; the resume/poll path IS called with the persisted taskId.
- Cross-provider dispatch: rows with `provider_kind='kie-veo'`/`'replicate-prediction'`/`'elevenlabs-async'` each go to the right `resumeX(taskId)` wrapper.
- No-taskId fallback: a stall-retry on a row with no `provider_task_id` (sync route — shouldn't happen but defense-in-depth) falls back to normal create-and-poll. Test asserts no crash.

## 9. Observability

- `provider_kind` + `reconcile_attempts` exposed in `/admin/jobs` listing (admin UI work — out of scope for these PRs but tracked).
- Cron logs: `[reconcile] scanned=N recovered=M failed=K stillRunning=J errors=E (Xms)` per tick.
- Credit anomalies: `force-fail + refund` from `reconcile_exhausted` logged via `checkAndLogAnomaly` so any pattern surfaces in admin.

## 9.1 Audit findings (2026-05-19) and their resolution

### Audit pass 1 (provider surface, jobs lifecycle, sync HTTP nodes)

| Audit finding | Resolution in spec |
|---|---|
| `provider_call_started_at` was never populated anywhere in the existing codebase | §5.2 `onTaskCreated` callback writes it for async; §5.8 `markProviderCallStart` writes it for sync routes |
| `usage_log_id` is not on the `jobs` table — spec earlier hand-waved how reconciliation would find it | D7 + §5.4 step 2 + §7 edge case: cron queries `usage_logs WHERE job_id=? AND status='reserved' LIMIT 1`, identical to existing `refundReservedCreditsForJob` |
| `started_at` is re-written on BullMQ stall-retry, so it's unsafe as a reconciliation threshold | D8 + §4.1: two distinct columns, threshold uses the stable `provider_call_started_at` |
| Sync HTTP routes (ai-writer, video-composer, after-effects, lottie-overlay, 3d-title, motion-graphics, image-to-text, ai-writer SSE) create job rows but were missing from v1 spec | D9 + §5.8: explicit table of all 8 routes + the `markProviderCallStart` helper they call |
| Sync routes sometimes never flip `pending → processing` (go straight to `completed` or `failed`) — `processing`-only index would miss stuck pending rows | §4: index predicate is `status IN ('pending','processing')` |
| Spec described `kie-llm` as if it were async-polled, but in fact KIE's LLM path is single-roundtrip sync | §4 table now annotates Sync/Async per row; `kie-llm` correctly marked Sync, sweep-only |
| Sync-sweep semantics were ambiguous (does it catch in-flight sync calls, or stuck post-processing?) | §5.6: explicit 3-case enumeration — handler crashed after LLM returned, post-LLM processing failed, legacy pre-Phase-1 stuck row |
| The 14 `provider_kind` values are complete; no new kinds needed | (no change needed) |
| Existing CAS pattern (`markJobCompleted` with `.neq("status","cancelled").select("id")`) already implements the spec's idempotency guarantee | §5.4: explicit reference to `workers/shared.ts:185`, no new pattern to invent |

### Audit pass 2 (migration safety, non-route paths, recovery edge cases)

| Audit finding | Resolution in spec |
|---|---|
| **BLOCKER:** Orchestrator `NODE_TIMEOUT_MS=30 min` shorter than longest legitimate poll budget (`kie-lip-sync` ≈60 min) — reconcile-completes after orchestrator timeout orphans `workflow_executions` row in `failed` state | §5.7 new section: extend `NODE_TIMEOUT_MS` to 90 min (Phase 3) AND add CAS-guarded sole-cause `workflow_executions` reopen step inside `finalizeJobWithMedia` |
| Reconcile attempt cap of 12 (≈60 min) too tight relative to 75-min lip-sync stale threshold | §5.5 inline comment + §7 edge case: `MAX_ATTEMPTS=18` (≈90 min), 15-min headroom over lip-sync threshold |
| `is_public` defaulting to `false` on reconcile contradicts free-tier baseline (Free/Basic users always get `public_outputs=true`) | §7 edge case rewritten: default to `true` when null; explanation of why this matches expected tier behavior |
| R2 PutObject idempotency was implied but not stated | §5.4 step 3 explicit: deterministic key per jobId, S3 atomic overwrite, no partial-write exposure |
| KIE / Replicate signed-URL TTL was not considered as a constraint on threshold tuning | §7 edge case + threshold invariant: stale threshold ≤ upstream URL TTL minus buffer; action item to confirm KIE TTL before Phase 3 lands |
| Migration 135 safety: linter rules (`IF NOT EXISTS`, no profiles-RLS recursion, model_pricing `ON CONFLICT`) | All satisfied as-written; partial-index predicate matches existing patterns in `001`, `016`, `132` |
| Pipelines / scheduled triggers / webhook triggers / app runs / component execution / sub-workflows / MCP / Telegram / render worker job-creation paths: all delegate to standard routes or orchestrator | Confirmed: spec's Phase 1 instrumentation on standard route handlers + worker handlers transitively covers all non-route paths. No additional plumbing needed. Pipeline wrapper jobs intentionally have no `provider_kind` because they don't call providers directly. |
| `force_private` + `should_watermark` are set by `creditGuard` AFTER the job INSERT — brief window where they're null | §7 edge case: the threshold filter excludes jobs that recent; by the time a row is past threshold, these fields are populated or the job is unrecoverable |
| Cancellation race: user cancels while reconcile is mid-finalize | §7 + §5.4: CAS guard on `markJobCompleted` (`.neq("status","cancelled")`) returns `{ok:false}` and reconcile skips commit; `commitJobCredits` has its own CAS on `usage_logs.status='reserved'` for double-shield |
| Variable-pricing composite identifiers (`gpt-image:high`, `flux:2K`) on reconcile commit | Non-issue: `commitJobCredits` takes the worker-computed `providerCostUsd` directly; no re-resolution of composite identifier needed at commit time |
| Provider dispatch ambiguity on stall-retry (`provider_kind='kie-veo'` → which endpoint?) | Non-issue: each of the 14 `provider_kind` values maps 1:1 to one upstream endpoint by table design (§4) |

## 10. Out of scope / future

- **Provider-cost reconciliation against KIE billing**: separate concern (already partially handled by `audit-credits` skill + `credit-anomaly`).
- **Aggressive deduplication on input fingerprint**: avoiding double-creating the same task on user double-click — different problem.
- **Migrating `suno-voice-create` sweep into the new system**: trivial follow-up after Phase 3 lands.

---

## Open questions for review

1. **Lip-sync threshold tuning.** Current proposal: 75-min `kie-lip-sync` threshold + `MAX_ATTEMPTS=18` (5-min cadence) = 90-min total before force-fail. Lip-sync's actual upstream max-poll budget is ≈60 min, so 75-min threshold catches stalls quickly while the attempt cap gives 15-min headroom for legitimately-long runs. **Resolution: confirmed in audit pass #2, finding #5 — keeping 75/18.** Flagging here in case operational data later shows a different distribution.
2. **KIE mediaUrl signed-URL TTL** (audit pass #2, finding #2). The spec invariant is: stale threshold ≤ upstream URL TTL minus a buffer. KIE's docs imply hours-of-validity TTLs, which is comfortably above the 5-75 min thresholds. **Action item before Phase 3 lands:** confirm KIE TTL via a direct doc check or test request. If it's tighter than expected, lower thresholds proportionally.
3. **`NODE_TIMEOUT_MS` extension from 30 → 90 min** is paired with §5.7's workflow_execution reopen logic. The orchestrator-level `WORKFLOW_TIMEOUT_MS=60 min` is NOT being touched — workflows that legitimately exceed 60 min in aggregate stay failed at the workflow level. Confirming this is the right scope.

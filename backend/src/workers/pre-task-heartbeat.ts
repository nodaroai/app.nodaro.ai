/**
 * Host-side liveness for every job the video worker runs.
 *
 * THE GAP (staging 2026-09-15, Pro 3D Render job 99ede351). The video worker
 * stamps `provider_kind = "pre-task"` + `provider_call_started_at = now` on
 * EVERY row it picks up (`video-worker.ts`), and the reconcile cron fails and
 * refunds a `pre-task` row whose stamp is older than
 * `STALE_THRESHOLD_MS["pre-task"]` (30 min) — `pre-task` is a sync kind, so the
 * sweep has nothing to recover and assumes the worker died. A run that
 * legitimately outlives the threshold must therefore refresh the stamp. Core
 * handlers that run long do (`SCENE3D_HEARTBEAT_MS`,
 * `LLM_STRUCTURED_HEARTBEAT_MS`); a private plugin had to remember to, and the
 * Pro 3D Render and advanced-preview workers never did — their only heartbeat
 * renews a stage-journal lease in Redis. The 30-second round-table fixture
 * runs 30–35 minutes, and was failed at minute 31 by the cron while its worker
 * was still rendering on the one container that ran it.
 *
 * THE INVARIANT. The worker wraps the handler AT ITS DISPATCH SITE — the one
 * place a handler is looked up by job name and run (`video-worker.ts`) — so
 * liveness is a property of dispatch itself, not of any map, merge order or
 * handler's memory: a future job type is covered the day it ships, with no
 * list to update. (The wrap once covered only the plugin loader's map; a core
 * ffmpeg long-runner — an hour-long multicam apply-edl cut — had the same
 * exposure.) A core handler with its own heartbeat is unaffected: both refresh
 * the same stamp, and the refresh is idempotent.
 *
 * WHAT "LIVE" MEANS. The refresh beats while the handler's promise is
 * unsettled in THIS process. If the process dies (deploy, OOM, SIGKILL) the
 * beats stop with it, the stamp ages, and the cron recovers the row exactly as
 * before — or BullMQ's stall re-pick gets there first and re-stamps it. The
 * refresh is a CAS on `provider_kind = "pre-task"` (`refreshPreTaskSentinel`),
 * so it never resurrects a sentinel a plugin cleared on purpose (gvp/evp, which
 * the 90-minute orchestrator sweep owns) and never overwrites a real provider
 * kind a handler moved the row to.
 *
 * WHY IT STOPS. A handler whose promise never settles would otherwise be kept
 * alive forever, and the 30-minute sweep is also the backstop for a HUNG
 * handler. The beats stop after a cap, so a hung job is still failed and
 * refunded one threshold later. The default cap is the orchestrator's own
 * per-node ceiling (`PRE_TASK_HEARTBEAT_MAX_MS`). A handler whose legitimate
 * run can outlive it — apply-edl, reached through a direct lane
 * (`POST /v1/apply-edl`, the MCP verb) with no orchestrator watching, whose
 * final-quality render of a long episode is hours of ffmpeg — declares its own
 * budget (`HandlerFn.livenessBudgetMs`, honoured by the dispatch site through
 * `maxMs`), composed from the kill budgets of its BOUNDED steps: the per-chunk
 * ffmpeg budget it hands `runFfmpeg`, its probes, its fetches. One number
 * decides "hung" for the heartbeat and for those steps.
 *
 * WHAT NO CAP BOUNDS (stated, not padded over):
 *  - Time spent WAITING for an ffmpeg slot. `FFMPEG_CONCURRENCY` slots are
 *    shared by `VIDEO_WORKER_CONCURRENCY` jobs; a spawn's kill budget starts
 *    at the spawn, the beats at dispatch. This is a residual for EVERY ffmpeg
 *    handler, and apply-edl's multi-hour slot holds are its dominant cause.
 *  - Steps with no ceiling of their own. The R2 client carries no request
 *    timeout, so storage I/O — apply-edl's chunk checkpoints, the 404
 *    fallback download, the deliverable upload after the render — has none;
 *    nor does the thumbnail step that follows every video handler
 *    (`utils/thumbnail.ts`: its frame-extract ffmpeg and ffprobe run with no
 *    timeout and outside the ffmpeg slot). These are outside every budget.
 *    They ride in the slack between a real run and its kill budgets plus the
 *    30 minutes after the last beat; that is a margin, not a bound.
 *  - The default cap itself is an empirical margin over today's inventory
 *    (relay polls ≤ 85 min; the media-proxy encode behind silence-detect runs
 *    at a 45-min ceiling; other slot-gated ffmpeg spawns at the 10-min
 *    default), not a derived bound. A handler that outgrows it declares a
 *    budget.
 *
 * THE DAG LANE AGREES (podcast Track 0.11). The orchestrator no longer cancels
 * a budgeted node at the flat `NODE_TIMEOUT_MS`: it reads the SAME declared
 * budget this wrapper beats for (`declaredJobBudgetMs`, `lib/job-budget.ts` —
 * the handler's `livenessBudgetMs` delegates to it) and holds the node's
 * processing to `max(budget, NODE_TIMEOUT_MS)` — the same figure
 * `effectiveHeartbeatMaxMs` beats for — growing the workflow's cap by the
 * excess. So a long apply-edl inside a workflow is watched for exactly as long
 * as its worker keeps it looking live: one number for both. Across a re-pick
 * too (decided 2026-09-24): when the orchestrator is re-picked mid-render
 * (deploy drain, crash + stall), its resume ADOPTS a budgeted row whose stamp
 * THIS heartbeat keeps fresh — fresh meaning younger than the reconcile cron's
 * own `pre-task` threshold (`cancelInFlightChildJobs`, `isLiveRenderRow`) —
 * and polls it on the row's original clocks instead of cancelling it and
 * re-rendering from zero. A stale or absent stamp still cancels + re-dispatches.
 *
 * Import note: `NODE_TIMEOUT_MS` is a pure constant from the workflow engine's
 * types module — no engine code is pulled into the worker by it.
 *
 * DRAIN HAND-OFF (app PR #1436). A drain hand-off leaves the handler with
 * `DrainAbortError`; the `finally` below stops the beats, the row keeps a stamp
 * at most one interval old, the worker moves the job back to the queue with a
 * short delay, and the successor's pickup writes a fresh stamp. The guard
 * tests pin interval + requeue delay far below the threshold.
 */
import { refreshPreTaskSentinel } from "../lib/reconcile/persistence.js"
import { NODE_TIMEOUT_MS } from "../services/workflow-engine/types.js"

/** Beat cadence. Same as the core long-runners (`SCENE3D_HEARTBEAT_MS`) and the
 *  video-analysis plugin: one missed write still leaves 28 minutes of margin. */
export const PRE_TASK_HEARTBEAT_MS = 60_000

/** The DEFAULT cap on how long the host keeps a still-running job looking
 *  live: the orchestrator's own per-node ceiling, past which a workflow has
 *  given up on the node. Today's handlers that declare nothing fit inside it
 *  (the relay polls ≤ 85 min, the plugin renders run ~35, scene3d /
 *  llm-structured beat for themselves, the media-proxy encode runs at a
 *  45-min ceiling, other slot-gated ffmpeg spawns at the 10-min default) — an empirical
 *  margin, not a derived bound. A handler that legitimately runs longer —
 *  apply-edl on a direct lane, where no orchestrator is watching — declares
 *  its own bound (`HandlerFn.livenessBudgetMs`); this constant never has to
 *  stretch to cover it. */
export const PRE_TASK_HEARTBEAT_MAX_MS = NODE_TIMEOUT_MS

type QueueHandler<J, C extends { jobId: string }> = (job: J, ctx: C) => Promise<void>

export interface PreTaskHeartbeatOptions {
  /** How long to keep beating before the run is treated as hung. A handler
   *  that knows its own work's budget passes that number so the two
   *  hung-detectors cannot disagree. It can only EXTEND the default
   *  (`PRE_TASK_HEARTBEAT_MAX_MS`): a shorter, zero, negative or non-finite
   *  value is ignored — the default is the floor every handler gets, and with
   *  storage I/O outside every budget a shorter cap would only take slack
   *  away from a live run. */
  readonly maxMs?: number
}

/** The cap a run actually gets: the declared budget when it extends the
 *  default, the default otherwise. Exported for its unit test. */
export function effectiveHeartbeatMaxMs(declared: number | undefined): number {
  return typeof declared === "number" && Number.isFinite(declared) && declared > PRE_TASK_HEARTBEAT_MAX_MS
    ? declared
    : PRE_TASK_HEARTBEAT_MAX_MS
}

/** One handler, beating while it runs. */
export function withPreTaskHeartbeat<J, C extends { jobId: string }>(
  handler: QueueHandler<J, C>,
  options: PreTaskHeartbeatOptions = {},
): QueueHandler<J, C> {
  const maxMs = effectiveHeartbeatMaxMs(options.maxMs)
  return async (job, ctx) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= maxMs) {
        clearInterval(timer)
        return
      }
      // Best-effort by contract; the catch is belt and braces so a future edit
      // to the refresh can never surface as an unhandled rejection here.
      void refreshPreTaskSentinel(ctx.jobId).catch(() => undefined)
    }, PRE_TASK_HEARTBEAT_MS)
    timer.unref?.()
    try {
      await handler(job, ctx)
    } finally {
      clearInterval(timer)
    }
  }
}

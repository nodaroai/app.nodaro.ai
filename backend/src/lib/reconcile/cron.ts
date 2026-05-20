import { supabase } from "../supabase.js"
import {
  STALE_THRESHOLD_MS,
  MIN_STALE_THRESHOLD_MS,
  isSyncKind,
  type ProviderKind,
} from "./types.js"
import { sweepStaleSyncJob } from "./sync-sweep.js"

export interface ReconcileResult {
  scanned: number
  swept: number
  /** Async kinds successfully dispatched to a per-provider handler. */
  recovered: number
  notStale: number
  errors: number
}

/** Per-tick scan cap. Sized to drain a thousands-of-rows backfill in a few
 *  ticks without blowing the 5-min cadence. Each row costs 2-3 DB roundtrips
 *  (CAS UPDATE + refund lookups), so 500 × ~30ms ≈ 15s wall-clock per tick. */
const BATCH_LIMIT = 500

/** SQL pre-filter buffer: rows newer than this are unconditionally skipped at
 *  the DB layer. Half the minimum threshold gives the planner a useful index
 *  cut without risking a missed-stale row when per-kind precision applies in
 *  `isStale()` below. */
const SQL_PREFILTER_BUFFER_MS = Math.floor(MIN_STALE_THRESHOLD_MS / 2)

interface CandidateRow {
  id: string
  provider_kind: string | null
  provider_task_id: string | null
  provider_call_started_at: string | null
  reconcile_attempts: number
  job_type: string | null
  input_data: Record<string, unknown> | null
}

const KIE_KINDS: ReadonlySet<string> = new Set([
  "kie-standard", "kie-veo", "kie-veo-1080p", "kie-suno", "kie-kontext",
  "kie-luma", "kie-kling3", "kie-runway", "kie-aleph", "kie-lip-sync",
])

const REPLICATE_KINDS: ReadonlySet<string> = new Set([
  "replicate-prediction", "replicate-training",
])

const ELEVENLABS_KINDS: ReadonlySet<string> = new Set([
  "elevenlabs-async",
])

function sqlCutoff(): string {
  return new Date(Date.now() - SQL_PREFILTER_BUFFER_MS).toISOString()
}

function isStale(row: CandidateRow): boolean {
  if (!row.provider_call_started_at) return false
  const elapsed = Date.now() - new Date(row.provider_call_started_at).getTime()
  if (row.provider_kind && row.provider_kind in STALE_THRESHOLD_MS) {
    return elapsed > STALE_THRESHOLD_MS[row.provider_kind as ProviderKind]
  }
  return elapsed > MIN_STALE_THRESHOLD_MS
}

/**
 * Reconciliation cron entrypoint. Scans inflight `jobs` rows whose
 * `provider_call_started_at` is past their kind's threshold and dispatches
 * by `provider_kind`:
 *   - sync kinds + null → sweepStaleSyncJob (mark failed + refund)
 *   - kie-* → reconcileKieJob
 *   - replicate-* → reconcileReplicateJob
 *   - elevenlabs-async → reconcileElevenLabsJob
 *
 * Async per-provider handlers either complete the job (via finalizeJobWithMedia),
 * fail it (markFailed + refund), or bump reconcile_attempts and try next tick.
 */
export async function reconcileInflightJobs(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    scanned: 0,
    swept: 0,
    recovered: 0,
    notStale: 0,
    errors: 0,
  }

  const { data, error } = await supabase
    .from("jobs")
    .select("id, provider_kind, provider_task_id, provider_call_started_at, reconcile_attempts, job_type, input_data")
    .in("status", ["pending", "processing"])
    .not("provider_call_started_at", "is", null)
    .lt("provider_call_started_at", sqlCutoff())
    .limit(BATCH_LIMIT)

  if (error) {
    console.error(`[reconcile/cron] candidate query failed:`, error.message)
    return result
  }

  const rows = (data ?? []) as CandidateRow[]
  result.scanned = rows.length

  for (const row of rows) {
    if (!isStale(row)) {
      result.notStale++
      continue
    }

    const kind = row.provider_kind as ProviderKind | null

    try {
      if (kind === null || isSyncKind(kind)) {
        await sweepStaleSyncJob({
          id: row.id,
          provider_kind: row.provider_kind,
          reconcile_attempts: row.reconcile_attempts,
        })
        result.swept++
      } else if (KIE_KINDS.has(kind)) {
        const { reconcileKieJob } = await import("./kie.js")
        await reconcileKieJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
        })
        result.recovered++
      } else if (REPLICATE_KINDS.has(kind)) {
        const { reconcileReplicateJob } = await import("./replicate.js")
        await reconcileReplicateJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
        })
        result.recovered++
      } else if (ELEVENLABS_KINDS.has(kind)) {
        const { reconcileElevenLabsJob } = await import("./elevenlabs.js")
        await reconcileElevenLabsJob({
          id: row.id,
          provider_kind: row.provider_kind,
          provider_task_id: row.provider_task_id,
          reconcile_attempts: row.reconcile_attempts,
          job_type: row.job_type,
          input_data: row.input_data,
        })
        result.recovered++
      } else {
        // Unknown provider_kind (e.g., a future variant added to types.ts
        // without updating the dispatch sets above). Spec §5.5 catch-all:
        // sweep stale rows so they don't accumulate forever.
        await sweepStaleSyncJob({
          id: row.id,
          provider_kind: row.provider_kind,
          reconcile_attempts: row.reconcile_attempts,
        })
        result.swept++
      }
    } catch (err) {
      console.error(`[reconcile/cron] handler failed for job ${row.id}:`, err)
      result.errors++
    }
  }

  return result
}

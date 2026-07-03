/**
 * R2 tmp-state module for the video-analysis node — the checkpoint that lets a
 * stalled/re-entered worker resume instead of re-analyzing every window.
 *
 * WHY R2 and NOT the jobs row: `jobs.input_data` is returned verbatim by MCP
 * (get_job / list_jobs), the REST job routes, and the admin list, and the
 * orchestrator holds an invariant that NOTHING writes `input_data` after the
 * INSERT. The window plan + per-window analyses are internal bookkeeping that
 * must never leak through those surfaces, so they live in a jobId-scoped R2
 * prefix instead: written on each window completion, re-read on re-entry,
 * deleted in the worker's `finally`, and reaped by the cleanup cron if the
 * `finally` never runs (crash).
 *
 * Keys are deterministic (jobId only) so a re-entering worker rebuilds them with
 * zero DB state. Uploads pass NO `trackUserId` — these transient files must
 * never count against a user's storage quota.
 */
import { uploadBufferToR2, deleteFromR2, readR2ObjectBuffer } from "../../lib/storage.js"
import type { WindowAnalysis } from "@nodaro/shared"

/**
 * R2 prefix (NO trailing slash) under which ALL video-analysis intermediates
 * live: `<prefix>/<jobId>/{source.mp4,window-<k>.mp4,state.json}`. Exported as
 * the single source of truth so the cleanup cron's aged reaper
 * (`sweepVideoAnalysisTmp`) scopes to the exact same prefix the worker writes
 * under — renaming it here moves both the writer and the reaper together, with
 * no silent drift.
 */
export const VIDEO_ANALYSIS_TMP_PREFIX = "video-analysis-tmp"

/** Checkpoint persisted to `state.json` between window completions. */
export interface VaState {
  meta: { durationSec: number; width: number; height: number; title?: string }
  windows: Array<{ k: number; startSec: number; endSec: number; r2Key: string }>
  results: Record<number, WindowAnalysis>
}

export interface VaTmpKeys {
  prefix: string
  source: string
  window: (k: number) => string
  state: string
}

/** Deterministic R2 keys for a job's transient video-analysis working set. */
export function vaTmpKeys(jobId: string): VaTmpKeys {
  const prefix = `${VIDEO_ANALYSIS_TMP_PREFIX}/${jobId}/`
  return {
    prefix,
    source: `${prefix}source.mp4`,
    window: (k: number) => `${prefix}window-${k}.mp4`,
    state: `${prefix}state.json`,
  }
}

/**
 * Read the checkpoint from the R2 ORIGIN (S3 API), never the public CDN. The
 * checkpoint is an internal consistency artifact uploaded with an immutable
 * Cache-Control, so reading it through the CDN could return a STALE snapshot (a
 * re-run silently re-billing already-analyzed windows) or a negative-cached 404
 * (a silent restart). Returns null on a missing object or malformed JSON — a
 * missing/unreadable checkpoint means "start fresh", never an error the worker
 * has to handle.
 */
export async function readVaState(jobId: string): Promise<VaState | null> {
  const buf = await readR2ObjectBuffer(vaTmpKeys(jobId).state)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString()) as VaState
  } catch {
    return null
  }
}

/**
 * Serialize checkpoint writes through an in-module promise chain. Window
 * completions run in parallel and each calls `writeVaState` with a fuller
 * `results` map; without serialization two in-flight PUTs to the same key could
 * interleave and the smaller snapshot could land last. Chaining guarantees PUTs
 * fire in call order. `.catch()` on the predecessor keeps one failed write from
 * poisoning every subsequent write, while the promise handed back to THIS caller
 * still rejects on its own upload failure.
 */
let lastWrite: Promise<unknown> = Promise.resolve()

export function writeVaState(jobId: string, state: VaState): Promise<void> {
  const key = vaTmpKeys(jobId).state
  const run = lastWrite
    .catch(() => {})
    .then(() => uploadBufferToR2(Buffer.from(JSON.stringify(state)), key, "application/json"))
  lastWrite = run
  return run.then(() => {})
}

/**
 * Best-effort teardown of a job's transient working set: the checkpoint, the
 * downloaded source, and every window clip 0..windowCount-1. `Promise.allSettled`
 * so a single missing/failed key never throws — the cleanup cron sweeps whatever
 * survives.
 */
export async function deleteVaTmp(jobId: string, windowCount: number): Promise<void> {
  const keys = vaTmpKeys(jobId)
  const targets = [
    keys.state,
    keys.source,
    ...Array.from({ length: windowCount }, (_, k) => keys.window(k)),
  ]
  await Promise.allSettled(targets.map((key) => deleteFromR2(key)))
}

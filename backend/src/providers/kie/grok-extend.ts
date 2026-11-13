/**
 * Grok Extend on KIE's market lane (`grok-imagine/extend`): one of Grok's own
 * clips in, the same clip back with the new seconds joined on.
 *
 *   input = { task_id, prompt, extend_at, extend_times }
 *   poll  → JSON.parse(resultJson) = { resultUrls: [<the whole clip>] }
 *
 * Grok takes no clip URL — only `task_id`, a successful Grok Imagine
 * text-to-video or image-to-video task made on this account
 * (`resolveGrokExtendSource` holds that before anything is reserved). The
 * body is an explicit allow-list (`GROK_EXTEND_FIELDS`):
 *   - `task_id` the source's own task,
 *   - `prompt` as written,
 *   - `extend_at` the second of the source the new footage starts from (a
 *     number, at least 2): the source's picture length, cut down to the
 *     hundredth (never past its last frame), so the extension continues from
 *     its end,
 *   - `extend_times` the seconds added, the STRING "6" or "10" (the schema's
 *     only two values).
 * Grok bills the seconds added at the source's resolution, so the body names
 * no resolution; the caller states it to the egress seam
 * (`reconcileOpts.dimensions`).
 */
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ProgressCallback, ReconcileOpts } from "../provider.interface.js"
import { MAX_POLL_ATTEMPTS_VIDEO, createKieTask, createSanitizedError, pollKieTask } from "./client.js"
import { GROK_EXTEND_MODEL_KEY, GROK_EXTEND_WIRE_MODEL } from "./models.js"

/** The seconds Grok can add (`extend_times`). */
export const GROK_EXTEND_SECONDS = [6, 10] as const
export type GrokExtendSeconds = (typeof GROK_EXTEND_SECONDS)[number]

/** The earliest second an extension may start from (the schema's `extend_at` minimum). */
export const GROK_EXTEND_AT_MIN_SEC = 2

/** The keys the body may carry — the allow-list the tests hold the request to. */
export const GROK_EXTEND_FIELDS = ["task_id", "prompt", "extend_at", "extend_times"] as const

export interface GrokExtendArgs {
  /** The source's KIE task: a completed Grok Imagine text-to-video or image-to-video run. */
  taskId: string
  /** Sent as written. */
  prompt: string
  /** The source's picture length in seconds: the extension starts from its end. */
  extendAtSec: number
  /** The seconds to add. */
  extendSec: GrokExtendSeconds
}

export interface GrokExtendResult {
  /** The provider's clip: the whole source with the extension joined. */
  url: string
  kieTaskId: string
  providerMs?: number
}

/**
 * The second the extension starts from: the source's picture length cut down
 * to the hundredth — never rounded up past its last frame (the 1e-9 keeps a
 * hundredth that floats a hair below itself, 6.29 × 100, whole) — and never
 * before {@link GROK_EXTEND_AT_MIN_SEC}.
 */
export function grokExtendAt(extendAtSec: number): number {
  const hundredths = Math.floor(extendAtSec * 100 + 1e-9)
  return Math.max(GROK_EXTEND_AT_MIN_SEC, hundredths / 100)
}

/**
 * The request body's `input` (no I/O). Throws — before anything is sent — for
 * a request the schema would refuse after the run was reserved: a blank task,
 * an unknown source length, or a length Grok does not add.
 */
export function grokExtendInput(args: GrokExtendArgs): Record<string, unknown> {
  if (args.taskId.trim() === "") throw createSanitizedError("Grok extend needs the source's task", "Video extension")
  if (!Number.isFinite(args.extendAtSec) || args.extendAtSec < 0) {
    throw createSanitizedError(`Grok extend needs the source length (got ${args.extendAtSec})`, "Video extension")
  }
  if (!(GROK_EXTEND_SECONDS as readonly number[]).includes(args.extendSec)) {
    throw createSanitizedError(`Grok extends by 6 or 10 seconds (got ${args.extendSec})`, "Video extension")
  }
  return {
    task_id: args.taskId,
    prompt: args.prompt,
    extend_at: grokExtendAt(args.extendAtSec),
    extend_times: String(args.extendSec),
  }
}

/**
 * Extend one Grok clip and poll the task to its end. Every failure is the
 * client's sanitized error (refunded by the worker's failure path); a task
 * that succeeds with no URL fails too, never an empty success.
 */
export async function runGrokExtend(
  args: GrokExtendArgs,
  reconcileOpts?: ReconcileOpts,
  onProgress?: ProgressCallback,
): Promise<GrokExtendResult> {
  const input = grokExtendInput(args)
  // The wire names the seconds `extend_times`, a key the shared egress reader
  // does not read, so the seconds added are named here. The resolution is the
  // source's (the caller's `dimensions`): the body carries none.
  const dimensions = { ...reconcileOpts?.dimensions, duration: args.extendSec, durationLabel: `${args.extendSec}s` }
  const { taskId } = await createKieTask(GROK_EXTEND_WIRE_MODEL, input, { modelKey: GROK_EXTEND_MODEL_KEY, dimensions })
  await fireOnTaskCreated(reconcileOpts, taskId, "[KIE.ai Grok extend]")
  const { resultJson, providerMs } = await pollKieTask(taskId, MAX_POLL_ATTEMPTS_VIDEO, onProgress)
  const url = resultJson.resultUrls?.[0] ?? resultJson.videoUrl
  if (!url) throw createSanitizedError("Grok extend task succeeded but no URL found", "Video extension")
  return { url, kieTaskId: taskId, ...(providerMs !== undefined ? { providerMs } : {}) }
}

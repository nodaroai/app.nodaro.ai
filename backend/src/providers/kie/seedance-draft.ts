import { SEEDANCE_DRAFT_FINALIZE_PROVIDER, SEEDANCE_DRAFT_FINALIZE_RESOLUTION } from "@nodaro/shared/model-catalog"
import type { ReconcileOpts } from "../provider.interface.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { KieError, runKieTask, type ProgressCallback } from "./client.js"
import { seedance25OutputFormat } from "./video.js"

/**
 * Seedance 2.5 Draft finalize on KIE: a SEPARATE market task that re-renders a
 * draft (made with `input.draft: true` on `bytedance/seedance-2-5`) as the same
 * take at 1080p. Nothing creative is re-sent — the task names the draft and
 * nothing else; seed, prompt, references, duration and audio are the draft's.
 *
 * Wire contract (paid probes, 2026-10-12):
 *  - only `1080p` is accepted;
 *  - `output_format` is REQUIRED in practice although the doc marks it optional
 *    (omitting it answers `500 "This field is required"`);
 *  - polls on the standard `/api/v1/jobs/recordInfo`.
 */
export const SEEDANCE_DRAFT_FINALIZE_KIE_MODEL = "bytedance/seedance-2-5-draft"

/** The user-facing message for a draft KIE no longer knows (expired or unknown). */
export const SEEDANCE_DRAFT_UNAVAILABLE_MESSAGE =
  "This Seedance draft can no longer be finalized — drafts are kept for about 7 days. Make a new draft and finalize it."

export function buildSeedanceDraftFinalizeInput(draftTaskId: string): Record<string, unknown> {
  return {
    draft_task_id: draftTaskId,
    resolution: SEEDANCE_DRAFT_FINALIZE_RESOLUTION,
    output_format: seedance25OutputFormat(),
  }
}

// KIE's words for a draft it cannot use. Its exact expired-draft wording is
// unverified, so this matches only text that names the draft reference, an
// expiry OF THE DRAFT (an expired token / key / signature is a credentials
// problem, not the draft) or a missing task — never a bare "draft", a bare
// "expired" or a generic failure, which
// stay on the normal retry / refund path. (A bogus id answered a generic
// "This field is required" in the probe; that is deliberately NOT matched —
// it does not say which field.)
const DRAFT_UNAVAILABLE_RE = /draft_task_id|\bdraft\b[^.]{0,40}\bexpired?\b|\bexpired?\b[^.]{0,40}\bdraft\b|\b(?:draft|task)\s+(?:id\s+)?(?:does\s+not\s+exist|not\s+(?:found|exist))\b/i

/** True when a KIE error says the draft itself is unusable (expired / unknown). */
export function isSeedanceDraftUnavailableError(err: unknown): boolean {
  if (!(err instanceof KieError)) return false
  if (err.contentPolicy) return false
  return DRAFT_UNAVAILABLE_RE.test(err.internalDetails)
}

/**
 * Run the finalize task for `draftTaskId` and return the 1080p clip. An expired
 * or unknown draft fails DETERMINISTICALLY (no queue retry — the same id fails
 * the same way) with {@link SEEDANCE_DRAFT_UNAVAILABLE_MESSAGE}.
 */
export async function runSeedanceDraftFinalize(
  draftTaskId: string,
  opts: { onProgress?: ProgressCallback; reconcile?: ReconcileOpts } = {},
): Promise<{ url: string; kieTaskId?: string; providerMs?: number }> {
  try {
    const r = await runKieTask(
      SEEDANCE_DRAFT_FINALIZE_KIE_MODEL,
      buildSeedanceDraftFinalizeInput(draftTaskId),
      undefined,
      opts.onProgress,
      {
        ...opts.reconcile,
        modelKey: SEEDANCE_DRAFT_FINALIZE_PROVIDER,
        dimensions: { resolution: SEEDANCE_DRAFT_FINALIZE_RESOLUTION },
      },
    )
    const url = r.resultJson.resultUrls?.[0] ?? r.resultJson.videoUrl
    if (!url) throw new Error("Seedance draft finalize succeeded but returned no video URL")
    return { url, kieTaskId: r.taskId, providerMs: r.providerMs }
  } catch (err) {
    if (isSeedanceDraftUnavailableError(err)) {
      throw new DeterministicJobError(SEEDANCE_DRAFT_UNAVAILABLE_MESSAGE, { cause: err })
    }
    throw err
  }
}

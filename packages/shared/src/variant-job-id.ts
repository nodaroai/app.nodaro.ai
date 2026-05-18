/**
 * R2-key + result-id suffix for multi-variant jobs. Provider returns multiple
 * URLs from a single task (Grok = up to 6 images, Suno = 2 tracks); each
 * variant gets a deterministic suffix-keyed ID so primary stays at the original
 * jobId for backwards compat and extras land under `${jobId}-v1`, `${jobId}-v2`, …
 *
 * Used by:
 *   - backend `uploadImageVariantsMaybeWatermark` (R2 key)
 *   - backend Suno `uploadAllSunoTracks` (R2 key)
 *   - frontend `poll-job.ts handleJobCompleted` (GeneratedResult.jobId)
 *   - frontend `run-handlers.ts` orchestrator poll loop (GeneratedResult.jobId)
 *
 * Changing the suffix scheme requires updating every caller, hence the shared helper.
 */
export function variantJobId(baseJobId: string, index: number): string {
  return index === 0 ? baseJobId : `${baseJobId}-v${index}`
}

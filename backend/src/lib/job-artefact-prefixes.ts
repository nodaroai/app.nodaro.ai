/**
 * Job ARTEFACTS a job's output names one level (or more) down inside
 * `jobs.output_data`, rather than as a top-level `…Url` string.
 *
 * The retention reapers (`ee/billing/cleanup-service.ts`) read a job's own
 * outputs off the TOP level of `output_data` only — deliberately: a nested url
 * is usually an echoed input or another job's object. An artefact whose url a
 * node keeps inside a structured output (a descriptor) is registered here, by
 * its key prefix, so it expires exactly like the job's other outputs. A url is
 * still deleted only in the job's own key family (`isOwnedObjectKey`), so a
 * registered prefix widens WHERE the reaper looks, never WHOSE file it takes.
 *
 * Registered:
 *  - `speaker-tracks/` — Speaker Frames' face-track body, `speaker-tracks/<jobId>.json`;
 *    the node's output is its descriptor, `output_data.json.url` (decided 2026-10-08).
 *
 * SYNC NOTE: the writer lives in the private cloud plugins package
 * (`SPEAKER_TRACKS_KEY_PREFIX`, without the trailing slash). Keep them equal,
 * or expiry leaves the track files behind.
 *
 * The admin app expunge (`lib/collect-app-r2-keys.ts`) walks `output_data`
 * recursively already and needs no registration.
 */
export const SPEAKER_TRACKS_PREFIX = "speaker-tracks/"

export const JOB_ARTEFACT_PREFIXES: readonly string[] = [SPEAKER_TRACKS_PREFIX]

/** True for an R2 key under a registered job-artefact prefix. */
export function isJobArtefactKey(key: string): boolean {
  return JOB_ARTEFACT_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Keys for a job's temporary provider uploads (decided 2026-10-09). Pure, so
 * the storage census can read them without the storage client.
 *
 * A temporary provider upload is a copy of the user's media made only so a
 * provider can fetch it: a Seedance extend's source tail and last frame, KIE's
 * resized mask, trimmed lip-sync audio and motion video, and format-converted
 * frames, HeyGen's capped audio, Suno's re-hosted source audio. No output names
 * one. Each lives in its job's scratch folder,
 * `tmp/provider-input/<jobId>/<name>-<nonce>.<ext>`, which `discardJobScratch`
 * (`lib/job-scratch.ts`) empties when the job ends.
 *
 * The file name never starts with the job id, so a scratch file is never in
 * the job's output family (`isOwnedObjectKey`): the expiry walk and the result
 * gate never take one for a deliverable.
 *
 * Outside a job (no job id) the key is the flat `tmp/provider-input/<name>-<nonce>.<ext>`
 * every such upload had before: no job's end can reach it, and only the
 * daily age sweep (`job-scratch-sweep.ts`, 7 days) deletes it.
 */
import { randomUUID } from "node:crypto"

/** The root of every scratch folder. Written only through this module
 *  (`job-output-files-census.test.ts` fails the build on another spelling). */
export const JOB_SCRATCH_ROOT = "tmp/provider-input/"

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/i

/** Whether `jobId` can name a scratch folder (a job id, nothing that could leave the root). */
export function isScratchJobId(jobId: string | undefined | null): jobId is string {
  return typeof jobId === "string" && JOB_ID.test(jobId)
}

/** The job's scratch folder, with its trailing slash. Throws on anything but a job id. */
export function jobScratchPrefix(jobId: string): string {
  if (!isScratchJobId(jobId)) throw new Error(`Not a job id for a scratch folder: ${JSON.stringify(jobId)}`)
  return `${JOB_SCRATCH_ROOT}${jobId}/`
}

/**
 * A new key for one scratch file of `jobId` (or the flat key, outside a job).
 * The nonce makes every key new: objects are served immutable, so no url is
 * ever written twice.
 */
export function jobScratchKey(jobId: string | undefined, name: string, ext: string): string {
  if (!SEGMENT.test(name)) throw new Error(`Bad scratch file name: ${JSON.stringify(name)}`)
  if (!SEGMENT.test(ext)) throw new Error(`Bad scratch file extension: ${JSON.stringify(ext)}`)
  const file = `${name}-${randomUUID().slice(0, 8)}.${ext}`
  return isScratchJobId(jobId) ? `${jobScratchPrefix(jobId)}${file}` : `${JOB_SCRATCH_ROOT}${file}`
}

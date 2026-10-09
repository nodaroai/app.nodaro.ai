/**
 * A job's OWN files, read off its whole `output_data` (decided 2026-10-08).
 *
 * The one rule the retention reapers (`ee/billing/cleanup-service.ts`) and the
 * admin app expunge (`lib/collect-app-r2-keys.ts`) share: walk every value at
 * every depth — nested objects and lists included — and take each string that
 * is one of our urls; keep it only when its key is in the job's own key family
 * (`isOwnedObjectKey`: `<prefix>/<jobId>` or `<prefix>/<jobId>-<suffix>`).
 *
 * WHERE a url sits says nothing about whose it is: an output routinely echoes
 * its inputs (a mask's source image, a descriptor's `sources`), and those
 * nest as deep as the job's own files do. So the walk reaches everything and
 * the key family alone decides. That is also why no per-prefix registry is
 * needed: a new prefix or a new nested shape is covered the day it ships, and
 * `lib/__tests__/job-output-files-census.test.ts` checks that every storage
 * writer keys its files so the family rule can see them.
 *
 * Pure: no storage client, no database. Callers still owe every key the
 * deleter's other questions (whose library holds it, did a relay target make
 * it) before they delete.
 */
import { randomUUID } from "node:crypto"
import { config } from "./config.js"
import { isOwnedObjectKey } from "./job-policy-outputs.js"

/**
 * The R2 key of one of our public urls (`R2_PUBLIC_URL` + "/" + key), or null
 * for any other string.
 */
export function r2KeyFromUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL || !url.startsWith(config.R2_PUBLIC_URL)) {
    return null
  }
  return url.replace(config.R2_PUBLIC_URL + "/", "")
}

export interface JobOutputFile {
  readonly url: string
  readonly key: string
}

/**
 * Every url of ours in `output`, at any depth, in first-seen order and once
 * each, split into the job's own files and a count of the rest (`heldBack`:
 * ours, but outside the job's family — an echoed input or another job's
 * object, which that object's own row reaps).
 */
export function ownedJobOutputFiles(jobId: string, output: unknown): { files: JobOutputFile[]; heldBack: number } {
  const files: JobOutputFile[] = []
  const seenUrls = new Set<string>()
  const seenKeys = new Set<string>()
  let heldBack = 0
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (seenUrls.has(value)) return
      const key = r2KeyFromUrl(value)
      if (!key) return
      seenUrls.add(value)
      if (!isOwnedObjectKey(jobId, key)) {
        heldBack++
        return
      }
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      files.push({ url: value, key })
      return
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v)
      return
    }
    if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v)
    }
  }
  walk(output)
  return { files, heldBack }
}

/** The keys of `ownedJobOutputFiles`. */
export function ownedJobOutputKeys(jobId: string, output: unknown): string[] {
  return ownedJobOutputFiles(jobId, output).files.map((f) => f.key)
}

/**
 * `value` with every string in `urls` replaced by null wherever it sits,
 * copied (never mutated). A reaper clears exactly the urls of the files it
 * deleted, so an output never loses a url whose file is still there. A url it
 * held back (an echoed input, another job's file) is left as is here; when
 * that file is deleted, its link is cleared in every output that names it
 * (`lib/job-output-references.ts`).
 */
export function withUrlsNulled(value: unknown, urls: ReadonlySet<string>): unknown {
  if (typeof value === "string") return urls.has(value) ? null : value
  if (Array.isArray(value)) return value.map((v) => withUrlsNulled(v, urls))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withUrlsNulled(v, urls)]),
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Keys a writer picks INSIDE the job's family (decided 2026-10-08)
// ---------------------------------------------------------------------------

/**
 * The key of a job's result with its audio stripped (Veo's silent copy):
 * `videos/<jobId>-silent.mp4`, in the job's family. ONE builder, called by
 * the writer and by the job-output census, so the two cannot drift apart.
 */
export function silentVideoKey(jobId: string): string {
  return `videos/${jobId}-silent.mp4`
}

/**
 * The key of an inpaint job's composited result: `inpaint/<jobId>.png`, the
 * job's own slot. Called by the writer and by the job-output census.
 */
export function inpaintCompositeKey(jobId: string): string {
  return `inpaint/${jobId}.png`
}

/**
 * The object id of a Seedance extend's raw `.mov` copy: `<jobId>-raw`, so the
 * file is `videos/<jobId>-raw.mov`. In the job's family, so its expiry finds
 * it, and never the deliverable's own slot (`videos/<jobId>.mp4`), so the copy
 * cannot be mistaken for the result.
 */
export function rawExtensionObjectId(jobId: string): string {
  return `${jobId}-raw`
}

/**
 * The object id of the source clip a later Seedance extend continues from:
 * `<jobId>-raw-ref`, so the file is `videos/<jobId>-raw-ref.mov` (decided
 * 2026-10-08, round 12). The extend copies the source job's raw `.mov` here
 * and reads its own copy, so every job owns what it needs and the source's
 * expiry never breaks it. A key of its own: every object is served immutable,
 * so no url is ever written twice — not even the job's `-raw` slot, which
 * holds the job's own raw extension.
 */
export function rawExtensionReferenceObjectId(jobId: string): string {
  return `${jobId}-raw-ref`
}

/**
 * The object id for a file the RUNNING job writes, possibly more than once:
 * `<jobId>-<label>-<nonce>`, in the job's family (so its expiry finds it) and
 * unguessable (the nonce). With no job running there is no job whose expiry
 * could take it, so the id is `<label>-<nonce>`: random, as before, and never
 * mistakable for a job's id.
 */
export function jobFileObjectId(jobId: string | undefined, label: string): string {
  return jobId ? `${jobId}-${label}-${randomUUID()}` : `${label}-${randomUUID()}`
}

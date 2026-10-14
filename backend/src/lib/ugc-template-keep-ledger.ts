/**
 * A template's kept example run, layer 2: the job ledger's proof (design: the provenance gate).
 *
 * Node data is written by the editor, so a video that layer 1 (`ugcKeepPlan`, @nodaro/render-rules)
 * reads as an AI creator's run keeps nothing until the author's own completed jobs say the same:
 * - L1, the creator image: the output of exactly one completed job of the author whose input names
 *   no address at all. A sampled creator's image is a prompt-only image job; a My photo run makes no
 *   image job (its image is the upload), so it is never proven, whatever its node data claims.
 * - L2, each take: the output of exactly one completed UGC Clip job of the author, whose row records
 *   that very creator image (`input_data.creatorImage`, written by the plugin's clip admission). A
 *   row without it (made before the plugin wrote it) proves nothing.
 * - L2b, each finished clip (UGC Finish): a take handed on as it came, or, on a video cut from one
 *   recorded speech, the output of exactly one completed UGC Finish job of the author, every video
 *   its input names being one of those proven takes. The proof traces through the clip rows: the
 *   finish row records no creator image, its takes do.
 * - L3, each finish render (join, overlay, captions, in that order): the output of exactly one
 *   completed job of the author, every video its input names being a take, a finished clip or an
 *   earlier finish render of the same video. A render that IS one of those videos (a join of a
 *   one-clip video hands its take on as it came, writing no job) is proven by that video's proof.
 *
 * A job is found by its output's object key (`<prefix>/<jobId>[-…]`, `objectKeyJobIdCandidates`;
 * a finished clip's job is its folder, `UGC_FINISH_KEY`), never by the node, and must own that key. An address that is not on our storage, two jobs, no job,
 * another user's job or an unfinished one: not proven. A read that fails throws (the publish refuses,
 * retryably, writing nothing).
 */
import { ugcAddressesIn, ugcCanonicalAddress, ugcKeptClaimAddresses, type UgcKeptChain } from "@nodaro/render-rules"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"

/** The fields of a `jobs` row the proof reads. */
export interface KeepJobRow {
  readonly id: string
  readonly user_id?: unknown
  readonly status?: unknown
  readonly input_data?: unknown
  readonly output_data?: unknown
}

export interface KeepLedgerDeps {
  /** The owner's jobs among `ids` (throws when the read fails). */
  readonly readJobs: (ids: readonly string[], owner: string) => Promise<readonly KeepJobRow[]>
  /** The object key an address names on our storage, or null. */
  readonly storageKey: (address: string) => string | null
}

/** The row field the plugin's clip admission records the creator image under. */
export const UGC_CLIP_CREATOR_IMAGE_FIELD = "creatorImage"

/** The job type of the plugin's UGC Finish job (a video cut from one recorded speech). */
export const UGC_FINISH_JOB_TYPE = "ugc-finish"

/**
 * Where the plugin's UGC Finish job writes each finished clip: `ugc/finish/<jobId>/clip<n>.mp4`. The
 * job is the key's folder, not its stem, so the family rule (`isOwnedObjectKey`) cannot name it.
 */
const UGC_FINISH_KEY = /^ugc\/finish\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/clip[1-9][0-9]*\.mp4$/i

/** The UGC Finish job a finished clip's key names, or null. */
export function ugcFinishKeyJobId(key: string): string | null {
  return UGC_FINISH_KEY.exec(key)?.[1] ?? null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VIDEO_PATH = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i

type Data = Record<string, unknown>
const isData = (x: unknown): x is Data => !!x && typeof x === "object" && !Array.isArray(x)

/** Every address a value holds, at any depth. */
function addressesIn(value: unknown, into: string[] = [], depth = 0): string[] {
  if (typeof value === "string") into.push(...ugcAddressesIn(value))
  else if (depth <= 8 && value && typeof value === "object") for (const item of Array.isArray(value) ? value : Object.values(value)) addressesIn(item, into, depth + 1)
  return into
}

/**
 * Is every value the chain would keep proven by the owner's own jobs (see the file comment)? Pure
 * over `deps`; one read for the whole chain.
 */
export async function proveKeptChain(chain: UgcKeptChain, owner: string, deps: KeepLedgerDeps): Promise<boolean> {
  const claims = chain.claims
  if (!chain.proven || !claims || owner === "") return false
  const canonical = (address: string) => ugcCanonicalAddress(address, deps.storageKey)
  const keys = new Map<string, string>()
  for (const url of ugcKeptClaimAddresses(claims)) {
    const key = deps.storageKey(url)
    if (!key) return false
    keys.set(url, key)
  }
  const candidates = (key: string) => {
    const finishJob = ugcFinishKeyJobId(key)
    return [...objectKeyJobIdCandidates(key), ...(finishJob ? [finishJob] : [])]
  }
  const ids = [...new Set([...keys.values()].flatMap(candidates).filter((id) => UUID_RE.test(id)))]
  if (ids.length === 0) return false
  const rows = await deps.readJobs(ids, owner)

  /** The one completed job of the owner that made `url` (and owns its key), or null. */
  const jobOf = (url: string, owns: (jobId: string, key: string) => boolean = isOwnedObjectKey): KeepJobRow | null => {
    const key = keys.get(url)!
    const target = canonical(url)
    const made = rows.filter(
      (row) =>
        row.user_id === owner &&
        row.status === "completed" &&
        owns(row.id, key) &&
        addressesIn(row.output_data).some((a) => canonical(a) === target),
    )
    return made.length === 1 ? made[0]! : null
  }

  // L1: the creator image, from a job whose input names no address.
  const imageJob = jobOf(claims.creatorImage)
  if (!imageJob || addressesIn(imageJob.input_data).length > 0) return false
  const creator = canonical(claims.creatorImage)

  // L2: each take, from a UGC Clip job that records this creator image.
  for (const take of claims.takes) {
    const job = jobOf(take)
    const input = isData(job?.input_data) ? job!.input_data : undefined
    if (!job || !input || input.type !== "ugc-clip") return false
    const recorded = input[UGC_CLIP_CREATOR_IMAGE_FIELD]
    if (typeof recorded !== "string" || canonical(recorded) !== creator) return false
  }

  const videosIn = (input: unknown) => addressesIn(input).filter((a) => VIDEO_PATH.test(a) || (deps.storageKey(a) ?? "").startsWith("videos/"))
  const takes = new Set(claims.takes.map(canonical))

  // L2b: each finished clip, a take as it came or a UGC Finish job's output made from the takes alone.
  const allowed = new Set(takes)
  const ownsFinished = (jobId: string, key: string) => ugcFinishKeyJobId(key) === jobId
  for (const url of claims.finished.flatMap((f) => f.urls)) {
    if (takes.has(canonical(url))) continue
    const job = jobOf(url, ownsFinished)
    const input = isData(job?.input_data) ? job!.input_data : undefined
    if (!job || !input || input.type !== UGC_FINISH_JOB_TYPE) return false
    const videos = videosIn(input)
    if (videos.length === 0 || videos.some((a) => !takes.has(canonical(a)))) return false
    allowed.add(canonical(url))
  }

  // L3: each finish render, made only from this video's takes, finished clips and earlier renders.
  // A render that is one of those already (a join of one take hands it on, writing no job) is proven with it.
  for (const finish of claims.finishes) {
    if (allowed.has(canonical(finish.url))) continue
    const job = jobOf(finish.url)
    if (!job) return false
    const videos = videosIn(job.input_data)
    if (videos.length === 0 || videos.some((a) => !allowed.has(canonical(a)))) return false
    allowed.add(canonical(finish.url))
  }
  return true
}

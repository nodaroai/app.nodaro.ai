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
 * - L3, each finish render (join, overlay, captions, in that order): the output of exactly one
 *   completed job of the author, every video its input names being a take or an earlier finish
 *   render of the same video.
 *
 * A job is found by its output's object key (`<prefix>/<jobId>[-…]`, `objectKeyJobIdCandidates`),
 * never by the node, and must own that key. An address that is not on our storage, two jobs, no job,
 * another user's job or an unfinished one: not proven. A read that fails throws (the publish refuses,
 * retryably, writing nothing).
 */
import { ugcAddressesIn, ugcCanonicalAddress, type UgcKeptChain } from "@nodaro/render-rules"
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
  const urls = [claims.creatorImage, ...claims.takes, ...claims.finishes.map((f) => f.url)]
  const keys = new Map<string, string>()
  for (const url of urls) {
    const key = deps.storageKey(url)
    if (!key) return false
    keys.set(url, key)
  }
  const ids = [...new Set([...keys.values()].flatMap((key) => objectKeyJobIdCandidates(key)).filter((id) => UUID_RE.test(id)))]
  if (ids.length === 0) return false
  const rows = await deps.readJobs(ids, owner)

  /** The one completed job of the owner that made `url`, or null. */
  const jobOf = (url: string): KeepJobRow | null => {
    const key = keys.get(url)!
    const target = canonical(url)
    const made = rows.filter(
      (row) =>
        row.user_id === owner &&
        row.status === "completed" &&
        isOwnedObjectKey(row.id, key) &&
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

  // L3: each finish render, made only from this video's takes and earlier renders.
  const allowed = new Set(claims.takes.map(canonical))
  for (const finish of claims.finishes) {
    const job = jobOf(finish.url)
    if (!job) return false
    const videos = addressesIn(job.input_data).filter((a) => VIDEO_PATH.test(a) || (deps.storageKey(a) ?? "").startsWith("videos/"))
    if (videos.length === 0 || videos.some((a) => !allowed.has(canonical(a)))) return false
    allowed.add(canonical(finish.url))
  }
  return true
}

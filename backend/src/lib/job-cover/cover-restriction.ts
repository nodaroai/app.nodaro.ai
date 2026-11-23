/**
 * Whether a picture shown as a job's cover names restricted bytes (decided
 * 2026-11-23, review round).
 *
 * A cover is a COPY (lib/job-cover/cover-store.ts): a content restriction on
 * the file it was copied from moves that file to evidence, but never touches
 * the copy, which sits at a key of its own. So the restriction reaches the
 * copy through the copy's key: every cover key carries the SOURCE STAMP of
 * the original file (lib/job-cover/cover-key.ts), and a cover is restricted
 * when its stamp is the stamp of a key in the active restricted set — as well
 * as when its own key is restricted or under the evidence prefix.
 *
 * Chosen over a `cover_source_key` column: the proof travels with the
 * address itself, so every read that returns a `coverUrl` (the job reads, a
 * session's feed, the Trash, the library's embed, a share and its card, a
 * webhook) is covered by the one check in `effectiveJobCover`, with no select
 * to keep in step and no column to gate on staging.
 *
 * Asked as this server knows the restrictions NOW, never waited on (as the
 * job gate and the share reads ask): the minute between two reads of the
 * set is the same bounded staleness everywhere.
 */
import { restrictedKeyOfAddress } from "../content-restriction-address.js"
import { restrictedKeysNow } from "../content-restriction-set.js"
import { isEvidenceKey } from "../evidence-keys.js"
import { coverStampOf, sourceStampOf } from "./cover-key.js"

/** The stamps of one restricted set, computed once per set the server reads. */
const stampsBySet = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>()

function restrictedStamps(keys: ReadonlySet<string>): ReadonlySet<string> {
  const known = stampsBySet.get(keys)
  if (known) return known
  const stamps = new Set([...keys].map(sourceStampOf))
  stampsBySet.set(keys, stamps)
  return stamps
}

/**
 * Whether `url` names restricted bytes: an address of ours whose key is
 * restricted or evidence, or a cover copy whose source is restricted. An
 * address that is not ours is never restricted here.
 */
export function isRestrictedCoverAddress(url: string, restrictedSet?: ReadonlySet<string>): boolean {
  const key = restrictedKeyOfAddress(url)
  if (!key) return false
  if (isEvidenceKey(key)) return true
  const restricted = restrictedSet ?? restrictedKeysNow()
  if (restricted.has(key)) return true
  const stamp = coverStampOf(key)
  return stamp !== null && restricted.size > 0 && restrictedStamps(restricted).has(stamp)
}

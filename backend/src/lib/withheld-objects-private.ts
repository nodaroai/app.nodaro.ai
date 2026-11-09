/**
 * A content policy's withheld files, on a deployment that deletes nothing.
 *
 * When a policy decision removes a job's own files — a blocked result, a
 * rejected hold (by a reviewer, or by the hold's TTL), a held job its owner
 * cancels — `deleteOwnedObjects` (lib/job-policy-outputs.ts) deletes them.
 * With STORAGE_DELETES=skip (lib/storage-deletes-setting.ts) nothing is
 * deleted, so those files would stay readable by their URL. Where this
 * deployment makes objects public through their own ACL (`STORAGE_OBJECT_ACL`
 * set — see `withObjectAcl` in lib/storage.ts), each one is made private
 * instead: one `PutObjectAclCommand` with the canned ACL `private` per key.
 * The file stays; its URL no longer reads it.
 *
 * Elsewhere nothing changes beyond the skipped delete's warning: a bucket
 * policy grants public read whatever an object's own ACL says, and some
 * stores (Cloudflare R2) have no object ACLs at all. A store that answers
 * `NotImplemented` stops the attempt at its first key, with a warning.
 *
 * Never a delete, and never a throw into the gate: a key that cannot be made
 * private is logged with its job and left as it was. Inert when deletes are
 * on — the caller asks `storageDeletesSkipped()` before it loads this module,
 * and `withheldObjectsGoPrivate()` asks again.
 */
import { PutObjectAclCommand } from "@aws-sdk/client-s3"
import { config } from "./config.js"
import { keptStoragePrefix } from "./kept-storage-prefixes.js"
import { assertOrdinaryMediaKey } from "./retained-image-keys.js"
import { s3 } from "./storage.js"
import { STORAGE_DELETES_OFF, storageDeletesSkipped } from "./storage-deletes-setting.js"

export interface WithheldObjectsOutcome {
  /** The keys now private. */
  readonly madePrivate: readonly string[]
  /** The keys whose ACL call failed; each stays as it was. */
  readonly failed: readonly string[]
  /** The store has no object ACLs, so nothing was changed. */
  readonly unsupported: boolean
}

/** Whether a withheld file is made private here: deletes are skipped, and objects are public by their own ACL. */
export function withheldObjectsGoPrivate(): boolean {
  return storageDeletesSkipped() && Boolean(config.STORAGE_OBJECT_ACL)
}

/** A store's answer for an API it does not implement (R2 answers object ACL calls this way). */
function isNotImplemented(err: unknown): boolean {
  const e = err as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } } | null | undefined
  return e?.name === "NotImplemented" || e?.Code === "NotImplemented" || e?.$metadata?.httpStatusCode === 501
}

/**
 * Make a withheld job's own files private, where this deployment keeps them
 * (see the module comment). A key under a kept prefix is the deployment's own
 * file, never a job's output, and is left alone. Keys are validated as a
 * delete validates them: a retained snapshot's key is refused.
 */
export async function keepWithheldObjectsPrivate(jobId: string, keys: readonly string[]): Promise<WithheldObjectsOutcome> {
  const candidates = [...new Set(keys)].filter((key) => keptStoragePrefix(key) === undefined)
  if (!withheldObjectsGoPrivate() || candidates.length === 0) return { madePrivate: [], failed: [], unsupported: false }
  candidates.forEach(assertOrdinaryMediaKey)

  const madePrivate: string[] = []
  const failed: string[] = []
  for (const key of candidates) {
    try {
      await s3.send(new PutObjectAclCommand({ Bucket: config.R2_BUCKET_NAME, Key: key, ACL: "private" }))
      madePrivate.push(key)
    } catch (err) {
      if (isNotImplemented(err)) {
        console.warn(
          `[job-policy] job ${jobId}: this storage has no object ACLs, so ${candidates.length - madePrivate.length} ` +
            `withheld file(s) stay as they are: ${STORAGE_DELETES_OFF}`,
        )
        return { madePrivate, failed, unsupported: true }
      }
      failed.push(key)
      console.error(
        `[job-policy] job ${jobId}: could not make ${key} private, so it stays readable by its URL: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (madePrivate.length > 0) {
    console.warn(`[job-policy] job ${jobId}: made ${madePrivate.length} withheld file(s) private instead of deleting them: ${STORAGE_DELETES_OFF}`)
  }
  return { madePrivate, failed, unsupported: false }
}

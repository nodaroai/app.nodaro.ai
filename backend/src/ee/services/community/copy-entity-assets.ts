import { copyR2ObjectToPrefix, r2KeyFromOurUrl } from "../../../lib/storage.js"
import { deleteKeysRecordingFailures } from "../../../lib/storage-delete.js"
import { refundStorage } from "../../../utils/file-validation.js"
import { COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "../../lib/community-entity-adapters.js"
import { deepCopyReferenceSheet } from "./asset-lifecycle.js"

/**
 * The ONE way an entity's asset files are copied for another owner: every
 * URL in the adapter's `assetFields` (a bare URL, a `{ name, url }` bucket,
 * a reference sheet with its nested panel / source / gen URLs, a map of
 * variant → URL or URL list) is copied under `destPrefix` and the field
 * rewritten to the copy. Shared by the community clone (`clone.ts`, from a
 * listing's snapshot) and the Nodaro Keepers copy (`ee/lib/keepers-store.ts`,
 * from the admin's own row), so the two can never diverge on what a copy
 * carries — and so no copy ever points at the source owner's files, which
 * their deletes and the retention sweeps would take away from under it.
 *
 * `bytes` is the authoritative size the caller charges to the new owner's
 * storage. A copy that fails part-way deletes what it had copied so far
 * before it throws: the caller has nothing to roll back for a throw here.
 */
export async function copyEntityAssets(
  entityType: EntityType,
  source: Record<string, unknown>,
  destPrefix: string,
): Promise<{ copiedAssets: Record<string, unknown>; copiedUrls: string[]; bytes: number }> {
  const adapter = COMMUNITY_ENTITY_ADAPTERS[entityType]
  const copiedUrls: string[] = []
  let bytes = 0
  const copyUrl = async (url: string): Promise<string> => {
    const { url: u, bytes: b } = await copyR2ObjectToPrefix(url, destPrefix)
    bytes += b
    copiedUrls.push(u)
    return u
  }

  const copiedAssets: Record<string, unknown> = {}
  try {
    for (const f of adapter.assetFields) {
      const copied = await copyFieldValue(f, source[f], copyUrl)
      if (copied !== undefined) copiedAssets[f] = copied
    }
  } catch (err) {
    await deleteCopiedUrls(copiedUrls).catch(() => {})
    throw err
  }
  return { copiedAssets, copiedUrls, bytes }
}

type CopyUrl = (url: string) => Promise<string>

/**
 * One asset field's value with every URL in it copied: a bare URL, a
 * `{ name, url }` bucket, a reference sheet (its nested panel / source / gen
 * URLs too), or a map of variant → URL or URL list. `undefined` for a field
 * that is absent or of no shape the copy knows — it is then not carried.
 */
async function copyFieldValue(field: string, value: unknown, copyUrl: CopyUrl): Promise<unknown> {
  if (value == null) return undefined
  if (typeof value === "string") return copyUrl(value)
  if (field === "sheets" && Array.isArray(value)) {
    return allOrThrow((value as Array<Record<string, unknown>>).map((s) => deepCopyReferenceSheet(s, copyUrl)))
  }
  if (Array.isArray(value)) {
    return allOrThrow(
      (value as Array<{ url?: string }>).map(async (it) => (it?.url ? { ...it, url: await copyUrl(it.url) } : it)),
    )
  }
  if (typeof value === "object") return copyVariantMap(value as Record<string, unknown>, copyUrl)
  return undefined
}

/** A variant → URL (or URL list) map with each URL copied; any other value passes through. One key at a time, in order. */
async function copyVariantMap(map: Record<string, unknown>, copyUrl: CopyUrl): Promise<Record<string, unknown>> {
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") entries.push([key, await copyUrl(value)])
    else if (Array.isArray(value)) entries.push([key, await allOrThrow(value.map((u) => (typeof u === "string" ? copyUrl(u) : u)))])
    else entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

/**
 * Every task settled before the first failure is thrown — never
 * `Promise.all`, which rejects while sibling copies are still in flight and
 * would land files in `copiedUrls` after the cleanup had read it (leaving
 * them in storage, uncharged, for good).
 */
async function allOrThrow<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks)
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
  if (failed) throw failed.reason
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value)
}

/** Delete the copied files (never the source's). */
async function deleteCopiedUrls(urls: readonly string[]): Promise<void> {
  const keys = urls.map((u) => r2KeyFromOurUrl(u)).filter((k): k is string => !!k)
  if (keys.length) await deleteKeysRecordingFailures(keys, "community")
}

/** Undo a copy that will not be used: delete its files and give the new owner's storage reservation back. */
export async function rollbackCopiedAssets(urls: readonly string[], userId: string, reservedBytes: number): Promise<void> {
  await deleteCopiedUrls(urls)
  if (reservedBytes > 0) await refundStorage(userId, reservedBytes)
}

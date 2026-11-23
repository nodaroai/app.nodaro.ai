import { createHash, randomUUID } from "node:crypto"

/**
 * Where a job's custom cover picture lives (lib/job-cover/cover-store.ts):
 *
 *   job-covers/<userId>/cover-<sourceStamp>-<writeId>.<ext>
 *
 * ONE KEY PER WRITE, never reused (decided 2026-11-23, review round). Every
 * cover a job is given is a fresh copy at a fresh key, so releasing one
 * job's copy can never take the picture of another job, or of a concurrent
 * write to the same job: no two writes ever name the same object. (The CDN
 * keeps every object for a year, immutable, so a fresh key is also the only
 * way a new picture is ever seen.)
 *
 * The SOURCE STAMP is the first 32 hex characters of the sha256 of the key
 * the picture was copied from — the original file's key, carried forward
 * when the source is itself one of the caller's covers. It is what lets a
 * content restriction on the original reach every copy made of it without a
 * column or a lookup: a copy is restricted when its stamp is the stamp of a
 * restricted key (lib/job-cover/cover-restriction.ts).
 *
 * The stem starts with `cover-`, never with a job id, so a cover is never
 * read as a member of a job's key family (lib/job-policy-outputs.ts).
 */
export const JOB_COVER_PREFIX = "job-covers/"

/** Hex characters of the source's sha256 kept in a cover key. */
const STAMP_HEX = 32

const COVER_NAME_RE = /^cover-([0-9a-f]{32})-[0-9a-f]{32}\.[a-z0-9]+$/

/** The folder a user's job covers sit in. */
export function jobCoverFolder(userId: string): string {
  return `${JOB_COVER_PREFIX}${userId.toLowerCase()}/`
}

/** The stamp of a source key: what a cover copied from it carries. */
export function sourceStampOf(sourceKey: string): string {
  return createHash("sha256").update(sourceKey).digest("hex").slice(0, STAMP_HEX)
}

/** The source stamp a cover key carries, or null when the key is not a cover of today's shape. */
export function coverStampOf(key: string): string | null {
  if (!isJobCoverKey(key)) return null
  const name = key.slice(key.lastIndexOf("/") + 1)
  return COVER_NAME_RE.exec(name)?.[1] ?? null
}

/**
 * The stamp a new copy of `sourceKey` carries: the source's own stamp when it
 * is a cover already (so a restriction on the ORIGINAL still reaches a copy
 * of a copy), else the stamp of the source key itself.
 */
export function stampForCopyOf(sourceKey: string): string {
  return coverStampOf(sourceKey) ?? sourceStampOf(sourceKey)
}

/** A fresh key for one write of a cover copied from `sourceKey`, for `userId`. */
export function newJobCoverKey(userId: string, sourceKey: string, ext: string): string {
  const writeId = randomUUID().replace(/-/g, "")
  return `${jobCoverFolder(userId)}cover-${stampForCopyOf(sourceKey)}-${writeId}.${ext}`
}

/** Whether `key` is one of `userId`'s own job covers. */
export function isOwnJobCoverKey(userId: string, key: string): boolean {
  return key.startsWith(jobCoverFolder(userId))
}

/** Whether `key` is any user's job cover. */
export function isJobCoverKey(key: string): boolean {
  return key.startsWith(JOB_COVER_PREFIX)
}

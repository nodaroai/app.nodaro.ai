/**
 * Where a restricted file's bytes go (migration 583): under
 * `evidence/<restriction id>/<its key>`, a kept prefix no delete in the app
 * removes (lib/kept-storage-prefixes.ts), no writer writes
 * (lib/storage.ts), the proxies and the job gate refuse whatever the
 * restricted set says, and nothing a user can read names: the restriction
 * id is on the record administrators alone read. The bucket itself is
 * public on Cloudflare, so the deployment adds an edge rule refusing the
 * path (docs/deployment.md); a self-hosted bucket's policy denies it.
 * A leaf: constants and pure helpers.
 */

export const EVIDENCE_STORAGE_PREFIX = "evidence/"

/** The evidence key of `key` under restriction `restrictionId`. */
export function evidenceKeyOf(restrictionId: string, key: string): string {
  return `${EVIDENCE_STORAGE_PREFIX}${restrictionId}/${key}`
}

/** Whether `key` is under the evidence prefix. */
export function isEvidenceKey(key: string): boolean {
  return key.startsWith(EVIDENCE_STORAGE_PREFIX)
}

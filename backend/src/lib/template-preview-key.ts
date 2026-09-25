import { createHash } from "node:crypto"

/**
 * Where a template's durable preview copy lives in R2.
 *
 * The CDN serves every object under a one-year immutable cache
 * (`R2_CACHE_CONTROL` in storage.ts) and there is no automated purge
 * (single-file purge exists in the Cloudflare dashboard/API), so a cover written
 * over a fixed key never reaches viewers again — the edge keeps serving the
 * first copy for a year. The key therefore carries a stamp derived from the
 * SOURCE url: a new cover lands on a new key (fresh URL, fresh cache), while
 * re-publishing the same cover stays idempotent (same source → same key,
 * overwritten in place).
 */
export function templatePreviewKey(templateId: string, sourceUrl: string, ext: string): string {
  const stamp = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12)
  return `templates/${templateId}/preview-${stamp}.${ext}`
}

/**
 * Every durable preview of a template — the legacy fixed `preview.<ext>` and
 * the stamped `preview-<stamp>.<ext>` — sits under this key prefix.
 */
export function templatePreviewPrefix(templateId: string): string {
  return `templates/${templateId}/preview`
}

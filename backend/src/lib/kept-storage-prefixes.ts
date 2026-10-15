import { SITE_ASSET_ARCHIVE_PREFIX } from "./site-asset-keys.js"
import { MAKER_LOGO_PREFIX } from "./maker-logo-keys.js"

export interface KeptStoragePrefix {
  prefix: string
  /** Why nothing in the app may delete under it (said in the skip warning). */
  why: string
}

/**
 * The storage prefixes no delete in this app removes — ONE list, each with
 * its reason. The files under them are the deployment's own, written by the
 * app itself or by its operator, and no user's row can own one.
 *
 * `deleteFromR2` / `batchDeleteFromR2` — every delete of the media bucket but
 * the retained snapshots' own queues (`storage-delete-census.test.ts`) — SKIP a
 * key under one, with a warning, rather than refuse it: a key can come from a
 * URL a user wrote into a row (any address on our own storage can be saved as
 * an asset the user owns), and a refusal would stop a whole cleanup sweep —
 * every user's — on it. A new prefix of the deployment's own files belongs
 * here; the guard cases in `storage.test.ts` run over this list.
 */
export const KEPT_STORAGE_PREFIXES: readonly KeptStoragePrefix[] = [
  {
    prefix: SITE_ASSET_ARCHIVE_PREFIX,
    why: "past builds' styling files are kept for good (lib/site-asset-archive.ts)",
  },
  {
    prefix: MAKER_LOGO_PREFIX,
    why: "the operator's model maker marks, served on GET /v1/models (lib/maker-logos.ts)",
  },
]

/** The kept prefix `key` falls under, or undefined for an ordinary key. */
export function keptStoragePrefix(key: string): KeptStoragePrefix | undefined {
  return KEPT_STORAGE_PREFIXES.find((kept) => key.startsWith(kept.prefix))
}

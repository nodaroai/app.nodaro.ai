import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { config, isCloud } from "./config.js"
import { SITE_ASSET_ARCHIVE_PREFIX, siteAssetKey, siteAssetType } from "./site-asset-keys.js"
import { isStorageConfigured, listObjectsByPrefix, uploadLocalFileToR2Key } from "./storage.js"

/**
 * The site's styling files from every deployment, kept for good.
 *
 * A build names its CSS, fonts and images by their content
 * (`index-Dz56B_55.css`) and ships only its own, so each deploy used to make
 * the last one's files disappear. Pages an earlier build served still ask for
 * them: a session replay (Clarity draws a recording with the stylesheet its
 * visitor had, at its original URL), a tab left open across a deploy. On boot
 * the server copies its build's styling files here — each name once, since a
 * name is its content — and the Caddyfile's `/assets/*` handle asks
 * `routes/site-assets.ts` for any name the running build does not have.
 * Nothing deletes from the archive: the storage layer's delete paths skip its
 * keys (`deleteFromR2`, `batchDeleteFromR2`).
 */

/**
 * On a production Cloud server by default — a developer's checkout says
 * "cloud" too, and its local build must never land in the archive production
 * serves. SITE_ASSET_ARCHIVE decides anywhere. Never without storage.
 */
export function siteAssetArchiveEnabled(): boolean {
  if (!isStorageConfigured()) return false
  if (config.SITE_ASSET_ARCHIVE === "auto") return isCloud() && config.NODE_ENV === "production"
  return config.SITE_ASSET_ARCHIVE === "on"
}

export interface SiteAssetStore {
  /** Every key under a prefix. */
  readonly listKeys: (prefix: string) => Promise<readonly string[]>
  /** Stores one file under a key, served as `contentType` and cached for good. */
  readonly upload: (filePath: string, key: string, contentType: string) => Promise<unknown>
}

export interface ArchiveSummary {
  /** The build's styling files. */
  readonly files: number
  /** Newly copied into the archive by this call. */
  readonly added: number
  /** Not copied this time — the next boot tries them again. */
  readonly failed: number
  /** Why the first of them was not. */
  readonly firstError?: string
}

/** A few at a time: boot shares the process with live traffic. */
const UPLOADS_AT_ONCE = 4

/**
 * Copies the styling files in `<buildDir>/assets` that the archive does not
 * hold yet. Never deletes, never overwrites: a name the archive has is that
 * same content already.
 */
export async function archiveSiteAssets(buildDir: string, store: SiteAssetStore): Promise<ArchiveSummary> {
  const dir = join(buildDir, "assets")
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const names = entries.filter((entry) => entry.isFile() && siteAssetType(entry.name) !== null).map((entry) => entry.name)
  if (names.length === 0) return { files: 0, added: 0, failed: 0 }
  const archived = new Set(await store.listKeys(`${SITE_ASSET_ARCHIVE_PREFIX}assets/`))
  const missing = names.filter((name) => !archived.has(siteAssetKey(name)))
  const failures: unknown[] = []
  for (let start = 0; start < missing.length; start += UPLOADS_AT_ONCE) {
    const batch = missing.slice(start, start + UPLOADS_AT_ONCE)
    const results = await Promise.allSettled(batch.map((name) => store.upload(join(dir, name), siteAssetKey(name), siteAssetType(name)!)))
    for (const result of results) if (result.status === "rejected") failures.push(result.reason)
  }
  const firstError = failures[0] === undefined ? undefined : failures[0] instanceof Error ? failures[0].message : String(failures[0])
  return { files: names.length, added: missing.length - failures.length, failed: failures.length, ...(firstError === undefined ? {} : { firstError }) }
}

/** This build's static files: `frontend/dist`, beside `backend/` — the same three levels up from `src/lib` and `dist/lib`. */
const BUILD_DIR = fileURLToPath(new URL("../../../frontend/dist", import.meta.url))

/** On boot, in the background: copies this build's styling files into the archive. One line of log; never throws. */
export async function archiveThisBuild(log: (message: string) => void): Promise<void> {
  if (!siteAssetArchiveEnabled()) return
  try {
    const { files, added, failed, firstError } = await archiveSiteAssets(BUILD_DIR, { listKeys: listObjectsByPrefix, upload: uploadLocalFileToR2Key })
    // On a server that archives, no files means the build is not where this looks: say so.
    if (files === 0) return log(`[site-assets] no styling files in ${BUILD_DIR}/assets — nothing archived`)
    log(`[site-assets] ${files} styling files in this build, ${added} newly archived${failed > 0 ? `, ${failed} failed (tried again on the next boot): ${firstError}` : ""}`)
  } catch (error) {
    log(`[site-assets] could not archive this build's styling files: ${error instanceof Error ? error.message : String(error)}`)
  }
}

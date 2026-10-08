/**
 * Copies the styling files a LIVE site serves right now into the archive of
 * past builds (`src/lib/site-asset-archive.ts`).
 *
 * A build archives itself when it boots. The build that is live when the
 * archive first ships never booted with it, so its files — the ones the
 * latest session replays point at — would be lost at the next deploy. Run
 * this right before that deploy, once per site:
 *
 *   cd backend && npx tsx scripts/backfill-site-assets.ts --dry-run https://app.nodaro.ai https://next.nodaro.ai
 *   cd backend && npx tsx scripts/backfill-site-assets.ts https://app.nodaro.ai https://next.nodaro.ai
 *
 * (Storage settings come from backend/.env, like every script here; the
 * backend's config also wants INTERNAL_ORCHESTRATOR_SECRET, 32+ characters.)
 *
 * Reads the site as a browser does: its HTML, every script chunk it reaches
 * (for the stylesheets lazily loaded pages need), every stylesheet (for its
 * fonts and images). Copies each styling file the archive lacks, refusing any
 * answer that is not the file — an HTML page in its place, an error. Writes
 * only under site-assets/, never overwrites, never deletes.
 */
import "dotenv/config"
import { assetNamesIn, looksLikeHtml } from "../src/lib/site-asset-crawl.js"
import { SITE_ASSET_ARCHIVE_PREFIX, siteAssetKey, siteAssetType } from "../src/lib/site-asset-keys.js"
import { isStorageConfigured, listObjectsByPrefix, uploadBufferToR2 } from "../src/lib/storage.js"

const AT_ONCE = 8

interface Fetched {
  readonly name: string
  readonly body: Buffer
  readonly refused?: string
}

async function fetchAsset(origin: string, name: string): Promise<Fetched> {
  try {
    const res = await fetch(`${origin}/assets/${name}`, { headers: { "User-Agent": "nodaro-site-asset-backfill" } })
    const body = Buffer.from(await res.arrayBuffer())
    if (!res.ok) return { name, body, refused: `HTTP ${res.status}` }
    if (looksLikeHtml(res.headers.get("content-type") ?? "", body.subarray(0, 64).toString("utf8"))) return { name, body, refused: "an HTML page, not the file" }
    return { name, body }
  } catch (error) {
    return { name, body: Buffer.alloc(0), refused: error instanceof Error ? error.message : String(error) }
  }
}

/** Every styling file the live site reaches, with its bytes — or why it was refused. */
async function crawl(origin: string): Promise<Fetched[]> {
  const page = await fetch(`${origin}/`, { headers: { "User-Agent": "nodaro-site-asset-backfill" } })
  if (!page.ok) throw new Error(`${origin}/ answered HTTP ${page.status}`)
  const seen = new Set<string>()
  const styling: Fetched[] = []
  let queue = assetNamesIn(await page.text(), "page")
  while (queue.length > 0) {
    const next: string[] = []
    const fresh = queue.filter((name) => !seen.has(name) && (name.endsWith(".js") || siteAssetType(name) !== null))
    fresh.forEach((name) => seen.add(name))
    for (let start = 0; start < fresh.length; start += AT_ONCE) {
      const answers = await Promise.all(fresh.slice(start, start + AT_ONCE).map((name) => fetchAsset(origin, name)))
      for (const answer of answers) {
        const script = answer.name.endsWith(".js")
        if (!script) styling.push(answer)
        if (answer.refused) continue
        if (script || answer.name.endsWith(".css")) next.push(...assetNamesIn(answer.body.toString("utf8"), script ? "script" : "stylesheet"))
      }
    }
    queue = next
  }
  return styling
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run")
  const origins = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).map((origin) => origin.replace(/\/+$/, ""))
  if (origins.length === 0) throw new Error("Usage: npx tsx scripts/backfill-site-assets.ts [--dry-run] <site origin> [<site origin> ...]")
  if (!isStorageConfigured()) throw new Error("Storage is not configured (R2_* in backend/.env)")
  const archived = new Set(await listObjectsByPrefix(`${SITE_ASSET_ARCHIVE_PREFIX}assets/`))
  for (const origin of origins) {
    const files = await crawl(origin)
    const refused = files.filter((file) => file.refused)
    const missing = files.filter((file) => !file.refused && !archived.has(siteAssetKey(file.name)))
    for (const file of missing) {
      if (!dryRun) await uploadBufferToR2(file.body, siteAssetKey(file.name), siteAssetType(file.name)!)
      archived.add(siteAssetKey(file.name))
    }
    console.log(`${origin}: ${files.length} styling files, ${files.length - refused.length - missing.length} already archived, ${missing.length} ${dryRun ? "would be copied" : "copied"}, ${refused.length} refused`)
    for (const file of refused) console.log(`  refused ${file.name}: ${file.refused}`)
    if (dryRun) for (const file of missing) console.log(`  would copy ${file.name} (${file.body.length} bytes)`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

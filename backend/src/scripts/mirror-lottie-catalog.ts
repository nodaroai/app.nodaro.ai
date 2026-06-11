/**
 * Mirror the committed built-in Lottie Overlay catalog to R2 (the Nodaro CDN).
 *
 * The 12 catalog animations live byte-for-byte in
 * `backend/assets/lottie-catalog/<slug>.json` and are served at the stable
 * system keys `lottie-catalog/<slug>.json` (public URL
 * `https://cdn.nodaro.ai/lottie-catalog/<slug>.json`). This script uploads them
 * via a plain PutObject overwrite — system assets, so NO trackUserId (the param
 * is optional on uploadBufferToR2) and no per-user storage accounting.
 *
 * Idempotent: every run is a full overwrite, never a delete (repo invariant —
 * we never delete R2 keys). Per file it asserts the JSON parses, contains no
 * unresolved `"sid"` slot reference, and has a non-empty `layers` array before
 * uploading — a malformed asset must fail loudly here, not at render time.
 *
 * Usage: cd backend && npx tsx src/scripts/mirror-lottie-catalog.ts
 */
import "dotenv/config"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { LOTTIE_OVERLAY_CATALOG } from "@nodaro/shared"
import { uploadBufferToR2 } from "../lib/storage.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/scripts → backend/assets/lottie-catalog
const ASSET_DIR = join(__dirname, "..", "..", "assets", "lottie-catalog")

interface ResultRow {
  slug: string
  bytes: number
  layers: number | "-"
  url: string
  status: "uploaded" | "FAILED"
}

async function main(): Promise<void> {
  const rows: ResultRow[] = []
  let failures = 0

  for (const entry of LOTTIE_OVERLAY_CATALOG) {
    const path = join(ASSET_DIR, `${entry.slug}.json`)
    try {
      const raw = await readFile(path, "utf-8")

      // Validate before upload: parse, no unresolved sid refs, non-empty layers.
      if (raw.includes('"sid"')) {
        throw new Error(`contains an unresolved "sid" slot reference (must be baked)`)
      }
      const parsed = JSON.parse(raw) as { layers?: unknown }
      const layers = Array.isArray(parsed.layers) ? parsed.layers.length : 0
      if (layers === 0) {
        throw new Error(`has no layers (empty or invalid Lottie document)`)
      }

      const buffer = Buffer.from(raw, "utf-8")
      const key = `lottie-catalog/${entry.slug}.json`
      await uploadBufferToR2(buffer, key, "application/json")

      rows.push({ slug: entry.slug, bytes: buffer.length, layers, url: entry.url, status: "uploaded" })
      console.log(`[mirror-lottie-catalog] uploaded ${key} (${buffer.length} bytes, ${layers} layers)`)
    } catch (err) {
      failures++
      rows.push({
        slug: entry.slug,
        bytes: 0,
        layers: "-",
        url: entry.url,
        status: "FAILED",
      })
      console.error(
        `[mirror-lottie-catalog] FAILED ${entry.slug}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  console.table(rows)
  console.log(
    `[mirror-lottie-catalog] ${rows.length - failures}/${rows.length} uploaded` +
      (failures ? `, ${failures} FAILED` : ""),
  )

  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error("[mirror-lottie-catalog] fatal:", err)
  process.exit(1)
})

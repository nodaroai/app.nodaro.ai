/**
 * Backfill: copy existing workflow_templates.preview_media_url values into the
 * durable templates/<id>/preview.<ext> R2 location.
 *
 * Why: the routes/workflow-templates.ts publish flow now copies on every
 * publish, so any template published or re-published after the fix landed is
 * safe. This script catches everything that was already in the DB at the time
 * of the fix and would otherwise stay fragile until its creator next clicks
 * Publish.
 *
 * For each candidate row:
 *   - HEAD the existing preview_media_url. Dead (404/410/403) → log for
 *     manual triage, do nothing.
 *   - Alive → copyToTemplatePreview() to templates/<id>/preview.<ext> and
 *     UPDATE the row to the durable URL.
 *
 * Idempotent: rows already pointing at templates/<id>/preview.* are skipped
 * up front, so a second run is a no-op.
 *
 * Usage:
 *   npm run backfill-template-previews -- --dry-run
 *   npm run backfill-template-previews
 *   npm run backfill-template-previews -- --limit 50
 *   npm run backfill-template-previews -- --concurrency 5
 */
import { supabase } from "../lib/supabase.js"
import { copyToTemplatePreview } from "../lib/storage.js"
import { config } from "../lib/config.js"
import { safeFetch } from "../lib/safe-fetch.js"

const PAGE_SIZE = 100
const HEAD_TIMEOUT_MS = 10_000

const MARKETPLACE = "marketplace"
const TUTORIAL = "tutorial"

interface TemplateRow {
  id: string
  creator_id: string
  name: string
  slug: string | null
  preview_media_url: string
  preview_media_type: string | null
  listed_in: string[] | null
}

interface DeadEntry {
  id: string
  name: string
  slug: string | null
  url: string
  channels: string[]
}

function parseArgs() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const limitIdx = args.indexOf("--limit")
  const limit =
    limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? "0", 10) || Infinity : Infinity
  const concIdx = args.indexOf("--concurrency")
  const concurrency =
    concIdx !== -1 ? parseInt(args[concIdx + 1] ?? "3", 10) || 3 : 3
  return { dryRun, limit, concurrency }
}

function detectMediaType(
  storedType: string | null,
  url: string,
): "image" | "video" {
  if (storedType === "video") return "video"
  if (storedType === "image") return "image"
  // Legacy rows may have preview_media_type=NULL. Fall back to URL extension.
  return /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) ? "video" : "image"
}

function isAlreadyMigrated(row: TemplateRow): boolean {
  if (!config.R2_PUBLIC_URL) return false
  const prefix = `${config.R2_PUBLIC_URL.replace(/\/$/, "")}/templates/${row.id}/preview.`
  return row.preview_media_url.startsWith(prefix)
}

function readListedIn(row: TemplateRow): string[] {
  return Array.isArray(row.listed_in) ? row.listed_in : []
}

async function probeAlive(url: string): Promise<"alive" | "dead" | "error"> {
  try {
    const res = await safeFetch(url, { method: "HEAD", timeoutMs: HEAD_TIMEOUT_MS })
    if (res.ok) return "alive"
    // Cloudflare R2's public domain returns 404 for missing keys; some origins
    // return 410. 403 is what you get when an object existed but was made
    // inaccessible. Anything in that family is "really gone, don't migrate".
    if (res.status === 404 || res.status === 410 || res.status === 403) return "dead"
    // Method-not-allowed: server doesn't support HEAD. Assume alive — GET
    // would probably work; copyToTemplatePreview will report the real error
    // if not.
    if (res.status === 405) return "alive"
    // 5xx / other unexpected status — treat as transient error, not a dead
    // source. Counter increments separately.
    return "error"
  } catch {
    return "error"
  }
}

async function fetchBatch(offset: number): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from("workflow_templates")
    .select("id, creator_id, name, slug, preview_media_url, preview_media_type, listed_in")
    .not("preview_media_url", "is", null)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) throw new Error(`workflow_templates query failed: ${error.message}`)
  return (data ?? []) as TemplateRow[]
}

type RowOutcome =
  | { kind: "already-migrated" }
  | { kind: "migrated"; newUrl: string }
  | { kind: "dead"; entry: DeadEntry }
  | { kind: "error"; reason: string }

async function processRow(row: TemplateRow, dryRun: boolean): Promise<RowOutcome> {
  if (isAlreadyMigrated(row)) return { kind: "already-migrated" }

  const probe = await probeAlive(row.preview_media_url)
  if (probe === "dead") {
    return {
      kind: "dead",
      entry: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        url: row.preview_media_url,
        channels: readListedIn(row),
      },
    }
  }
  if (probe === "error") {
    return {
      kind: "error",
      reason: `probe failed for ${row.id} (${row.preview_media_url})`,
    }
  }

  const mediaType = detectMediaType(row.preview_media_type, row.preview_media_url)

  if (dryRun) {
    return {
      kind: "migrated",
      newUrl: `(dry-run) would copy ${row.preview_media_url} → templates/${row.id}/preview.<ext>`,
    }
  }

  try {
    const durableUrl = await copyToTemplatePreview(
      row.preview_media_url,
      row.id,
      mediaType,
      row.creator_id,
    )
    const { error: updateError } = await supabase
      .from("workflow_templates")
      .update({ preview_media_url: durableUrl, preview_media_type: mediaType })
      .eq("id", row.id)
    if (updateError) {
      return { kind: "error", reason: `DB update for ${row.id}: ${updateError.message}` }
    }
    return { kind: "migrated", newUrl: durableUrl }
  } catch (err) {
    return {
      kind: "error",
      reason: `copy failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function classifyDead(entries: DeadEntry[]): {
  tutorials: DeadEntry[]
  marketplace: DeadEntry[]
  unlisted: DeadEntry[]
} {
  const tutorials: DeadEntry[] = []
  const marketplace: DeadEntry[] = []
  const unlisted: DeadEntry[] = []
  for (const e of entries) {
    if (e.channels.includes(TUTORIAL)) tutorials.push(e)
    else if (e.channels.includes(MARKETPLACE)) marketplace.push(e)
    else unlisted.push(e)
  }
  return { tutorials, marketplace, unlisted }
}

function printDeadGroup(label: string, entries: DeadEntry[]) {
  if (entries.length === 0) return
  console.log(`\n  ${label} (${entries.length}):`)
  for (const e of entries) {
    console.log(`    - ${e.id} | ${e.name} | slug=${e.slug ?? "—"}`)
    console.log(`        url: ${e.url}`)
  }
}

async function main() {
  const { dryRun, limit, concurrency } = parseArgs()

  if (!config.R2_PUBLIC_URL) {
    console.error(
      "R2_PUBLIC_URL is not set. The script can't decide which rows are " +
        "already-migrated without it. Aborting.",
    )
    process.exit(1)
  }

  console.log("Backfill template previews")
  console.log(
    `  dry-run: ${dryRun}, limit: ${limit === Infinity ? "none" : limit}, ` +
      `concurrency: ${concurrency}`,
  )
  console.log(`  R2_PUBLIC_URL: ${config.R2_PUBLIC_URL}`)
  console.log(`  Supabase URL: ${config.SUPABASE_URL}`)
  console.log()

  let offset = 0
  let scanned = 0
  let alreadyMigrated = 0
  let migrated = 0
  let errors = 0
  const deadEntries: DeadEntry[] = []
  const errorReasons: string[] = []

  while (scanned < limit) {
    const batch = await fetchBatch(offset)
    if (batch.length === 0) break

    const toProcess = batch.slice(0, Math.min(batch.length, limit - scanned))

    for (let i = 0; i < toProcess.length; i += concurrency) {
      const chunk = toProcess.slice(i, i + concurrency)
      const outcomes = await Promise.all(chunk.map((r) => processRow(r, dryRun)))
      for (let k = 0; k < outcomes.length; k++) {
        const o = outcomes[k]
        const row = chunk[k]
        scanned++
        if (o.kind === "already-migrated") {
          alreadyMigrated++
        } else if (o.kind === "migrated") {
          migrated++
          console.log(`  [migrated] ${row.id} ${dryRun ? "(dry-run)" : ""}: ${o.newUrl}`)
        } else if (o.kind === "dead") {
          deadEntries.push(o.entry)
          const ch = o.entry.channels.length ? o.entry.channels.join(",") : "unlisted"
          console.log(`  [dead]     ${row.id} [${ch}] ${row.preview_media_url}`)
        } else {
          errors++
          errorReasons.push(o.reason)
          console.log(`  [error]    ${o.reason}`)
        }
      }
    }

    offset += PAGE_SIZE
    if (batch.length < PAGE_SIZE) break
  }

  const { tutorials, marketplace, unlisted } = classifyDead(deadEntries)

  console.log()
  console.log("=".repeat(60))
  console.log("Backfill summary")
  console.log("=".repeat(60))
  console.log(`  Scanned:           ${scanned}`)
  console.log(`  Already-migrated:  ${alreadyMigrated} (skipped)`)
  console.log(`  Migrated:          ${migrated} ${dryRun ? "(dry-run — no writes)" : ""}`)
  console.log(
    `  Dead-source:       ${deadEntries.length} ` +
      `(${tutorials.length} tutorial, ${marketplace.length} marketplace, ${unlisted.length} unlisted)`,
  )
  console.log(`  Errors:            ${errors}`)

  if (deadEntries.length > 0) {
    console.log()
    console.log("Dead sources (manual triage needed — source URL returned 404/410/403):")
    printDeadGroup("TUTORIALS — chase up first", tutorials)
    printDeadGroup("Marketplace templates", marketplace)
    printDeadGroup("Unlisted templates", unlisted)
  }

  if (errorReasons.length > 0) {
    console.log()
    console.log("Errors:")
    for (const r of errorReasons) console.log(`  - ${r}`)
  }

  process.exit(errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("Backfill crashed:", err)
  process.exit(1)
})

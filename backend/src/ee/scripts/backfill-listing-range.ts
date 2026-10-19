/**
 * Fill the "up to" listing columns (migration 517, decided 2026-10-14) of every
 * published app, component and template stored before them.
 *
 * WHY. A listing's price is a range: "from" the saved settings (the columns it
 * always had), "up to" the most a run can cost over the choices its user has.
 * The ceiling is computed at publish; a version published before migration 517
 * holds NULL there and lists its "from" figure alone until its next publish.
 * This script computes each version's ceiling exactly as a republish does —
 * `resolveCanvasResultIds` then `estimateWorkflowListingCredits` with its
 * snapshot's settings (`snapshotSettings`: its exposed fields are the choices) —
 * and writes the "up to" columns ONLY. The "from" columns are never touched, so
 * a price change since publish moves nothing a user already sees; the card
 * shows the larger of the two as the "up to" (`storedListingRange`).
 *
 * WHAT IT WRITES. published_apps (apps and components, every non-deleted
 * version): `base_max_*` / `max_*` for the fixed, per-minute and per-item
 * parts, the fee applied as at publish (the row's own monetization).
 * workflow_templates (with `--include-templates`): `max_estimated_credits` /
 * `max_estimated_per_minute_credits`, unmarked. Only rows whose values differ —
 * a second run prints every row as `=` and writes nothing.
 *
 * NEVER run against the shared database by hand: it runs after migration 517
 * has applied (it refuses otherwise), from an admin shell or CI with the
 * production configuration.
 *
 * CACHE. The app runner holds an app's row in an in-process cache for up to 30
 * minutes (`routes/app-runner.ts`); the gallery reads the table directly.
 *
 * ENVIRONMENT: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_ORCHESTRATOR_SECRET
 * (32+ characters), EDITION=cloud (the estimate prices the charged table only there).
 *
 * Usage (dry run is the DEFAULT):
 *   cd backend && npm run backfill:listing-range -- --report ./listing-range.json
 *   … -- --include-templates          # workflow_templates too
 *   … -- --apply                      # write the differing rows
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { supabase } from "../../lib/supabase.js"
import { hasCredits } from "../../lib/config.js"
import { resolveCanvasResultIds } from "../../lib/canvas-result-ids.js"
import { exposedListNodeIds, exposedMediaNodeIds, exposedTextCaps } from "../../lib/exposed-text-caps.js"
import { appListingMaxColumns, type AppListingSplit } from "../../lib/app-listing-price.js"
import { MAX_COLUMNS } from "../../lib/listing-max-columns.js"
import { estimateWorkflowListingCredits, type EstimateEdge, type EstimateNode, type ListingPublishType } from "../billing/credits.js"
import { usecaseMulticamForEveryone } from "../../lib/use-case/inner-availability.js"
import { loadAvailabilityOverridesForScript } from "../../lib/availability-override.js"

// ---------------------------------------------------------------------------
// Pure parts (tested in __tests__/backfill-listing-range.test.ts)
// ---------------------------------------------------------------------------

type Columns = Record<string, number>

/** An app's / component's "up to" columns: the ceiling priced with the row's own fee, as at publish. */
export function appMaxColumns(
  row: { monetization_enabled: boolean | null; monetization_flat_fee: number | null; monetization_percent: number | null },
  ceiling: AppListingSplit,
): Columns {
  return appListingMaxColumns(ceiling, { enabled: row.monetization_enabled === true, flatFee: row.monetization_flat_fee ?? 0, percent: row.monetization_percent ?? 0 })
}

/** A template's "up to" columns: the ceiling's two parts, unmarked (a template has no fee). */
export function templateMaxColumns(ceiling: AppListingSplit): Columns {
  return {
    max_estimated_credits: ceiling.preview + ceiling.final,
    max_estimated_per_minute_credits: (ceiling.previewPerMinute ?? 0) + (ceiling.finalPerMinute ?? 0),
  }
}

/** The columns to write, or null when the row already holds them (idempotence). */
export function planRangeWrite(stored: Readonly<Record<string, unknown>>, next: Columns): Columns | null {
  return Object.entries(next).every(([k, v]) => stored[k] === v) ? null : next
}

export interface RangeBackfillOptions {
  readonly apply: boolean
  readonly includeTemplates: boolean
  readonly report: string
}

export function parseRangeArgs(argv: ReadonlyArray<string>): RangeBackfillOptions {
  const reportIdx = argv.indexOf("--report")
  const day = new Date().toISOString().slice(0, 10)
  return {
    apply: argv.includes("--apply"),
    includeTemplates: argv.includes("--include-templates"),
    report: reportIdx !== -1 && argv[reportIdx + 1] ? argv[reportIdx + 1]! : `./listing-range-backfill-${day}.json`,
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface ListingRow {
  readonly id: string
  readonly slug: string
  readonly creator_id: string
  readonly snapshot_nodes: unknown
  readonly snapshot_edges: unknown
  readonly snapshot_settings: unknown
  readonly publish_type?: string | null
  readonly monetization_enabled?: boolean | null
  readonly monetization_flat_fee?: number | null
  readonly monetization_percent?: number | null
  readonly [column: string]: unknown
}

async function readAll(table: "published_apps" | "workflow_templates", columns: string, deletedFilter: boolean): Promise<ListingRow[]> {
  const rows: ListingRow[] = []
  for (let from = 0; ; ) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).range(from, from + 499)
    if (deletedFilter) query = query.is("deleted_at", null)
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message} (has migration 517 reached this database?)`)
    const page = (data ?? []) as unknown as ListingRow[]
    rows.push(...page)
    if (page.length < 500) return rows
    from += page.length
  }
}

async function ceilingOf(row: ListingRow, publishType: ListingPublishType): Promise<AppListingSplit> {
  const settings = (row.snapshot_settings ?? {}) as Record<string, unknown>
  const raw = Array.isArray(row.snapshot_nodes) ? (row.snapshot_nodes as EstimateNode[]) : []
  // The publish path, exactly: the snapshot's saved result ids resolved first.
  const nodes = (await resolveCanvasResultIds(raw as never, row.creator_id, { settings })) as unknown as EstimateNode[]
  const edges = (Array.isArray(row.snapshot_edges) ? row.snapshot_edges : []) as EstimateEdge[]
  const listing = await estimateWorkflowListingCredits(nodes, edges, {
    publishType,
    speechTextCaps: exposedTextCaps(settings, nodes),
    replaceableMediaNodeIds: publishType === "template" ? exposedMediaNodeIds(null, nodes) : exposedMediaNodeIds(settings, nodes),
    ...(publishType === "template" ? {} : { exposedListNodeIds: exposedListNodeIds(settings, nodes) }),
    snapshotSettings: settings,
    // As a republish prices it: a general user's run (decided 2026-10-20).
    ...(usecaseMulticamForEveryone(nodes) ? { multicam: true } : {}),
  })
  return listing.ceiling ?? listing
}

export async function runRangeBackfill(opts: RangeBackfillOptions): Promise<{ ok: boolean; written: number; rows: number }> {
  if (!hasCredits()) {
    console.error("Refusing: this environment is not the Cloud edition (set EDITION=cloud). Outside it the estimate prices unmarked and without the admin price overrides.")
    return { ok: false, written: 0, rows: 0 }
  }
  // A listing is priced as a general user's run (usecaseMulticamForEveryone): read the
  // deployment's availability first — a cold cache would read Speaker Map as released.
  if (!(await loadAvailabilityOverridesForScript())) {
    console.error("Refusing: the deployment's availability (Admin → Availability) could not be read. Without it a node hidden from users reads as released, and a listing would be priced as their run is not.")
    return { ok: false, written: 0, rows: 0 }
  }
  console.log(`[range-backfill] mode=${opts.apply ? "APPLY" : "dry run"} templates=${opts.includeTemplates ? "yes" : "no"}`)
  const report: Array<{ table: string; slug: string; before: Record<string, unknown>; after: Columns; changed: boolean }> = []
  let written = 0

  const apps = await readAll(
    "published_apps",
    `id, slug, creator_id, publish_type, snapshot_nodes, snapshot_edges, snapshot_settings, monetization_enabled, monetization_flat_fee, monetization_percent, ${MAX_COLUMNS.published_apps.join(", ")}`,
    true,
  )
  for (const row of apps) {
    const publishType: ListingPublishType = row.publish_type === "component" ? "component" : "app"
    const after = appMaxColumns(row as never, await ceilingOf(row, publishType))
    const write = planRangeWrite(row, after)
    const before = Object.fromEntries(MAX_COLUMNS.published_apps.map((c) => [c, row[c]]))
    report.push({ table: "published_apps", slug: row.slug, before, after, changed: write !== null })
    console.log(`${row.slug} · ${publishType} · up to ${String(before.max_estimated_credits)} ${write ? "→" : "="} ${after.max_estimated_credits}`)
    if (write && opts.apply) {
      const { error } = await supabase.from("published_apps").update(write).eq("id", row.id)
      if (error) throw new Error(`published_apps ${row.slug}: ${error.message}`)
      written += 1
    }
  }

  if (opts.includeTemplates) {
    const templates = await readAll(
      "workflow_templates",
      `id, slug, creator_id, snapshot_nodes, snapshot_edges, snapshot_settings, ${MAX_COLUMNS.workflow_templates.join(", ")}`,
      false,
    )
    for (const row of templates) {
      const after = templateMaxColumns(await ceilingOf(row, "template"))
      const write = planRangeWrite(row, after)
      const before = Object.fromEntries(MAX_COLUMNS.workflow_templates.map((c) => [c, row[c]]))
      report.push({ table: "workflow_templates", slug: row.slug, before, after, changed: write !== null })
      console.log(`${row.slug} · template · up to ${String(before.max_estimated_credits)} ${write ? "→" : "="} ${after.max_estimated_credits}`)
      if (write && opts.apply) {
        const { error } = await supabase.from("workflow_templates").update(write).eq("id", row.id)
        if (error) throw new Error(`workflow_templates ${row.slug}: ${error.message}`)
        written += 1
      }
    }
  }

  const changed = report.filter((r) => r.changed).length
  console.log(`[range-backfill] ${report.length} row(s), ${changed} differ${opts.apply ? `, ${written} written` : " (dry run — nothing written)"}`)
  writeFileSync(opts.report, JSON.stringify({ generatedAt: new Date().toISOString(), apply: opts.apply, rows: report }, null, 2))
  console.log(`[range-backfill] report: ${opts.report}`)
  return { ok: true, written, rows: report.length }
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  runRangeBackfill(parseRangeArgs(process.argv.slice(2)))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}

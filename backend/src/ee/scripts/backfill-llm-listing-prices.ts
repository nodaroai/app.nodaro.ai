// @registry-enumerates prices each stored listing's whole graph (estimateWorkflowListingCredits), every node it holds
/**
 * Recompute the stored listing of every published app, component and template
 * whose graph makes a metered LLM call — for metered LLM pricing (plan v2
 * Task 12, run after each release: Task 17).
 *
 * WHY. A listing's price is computed ONCE, at publish. A version published
 * while LLM calls billed in tiers advertises its LLM nodes at their tier rows;
 * once the server prices them per model (metered: the model's typical-usage
 * estimate) it would advertise the old tier figure until its next republish.
 * This script prices each candidate exactly as a republish does —
 * `resolveCanvasResultIds`, then `estimateWorkflowListingCredits` with its
 * snapshot's exposed inputs and settings (the "up to" range included) — so a
 * non-LLM price change since publish moves too (the dry run lists every delta
 * before anything is written).
 *
 * WHAT IT WRITES. published_apps (apps and components, every non-deleted
 * version): `base_estimated_credits` / `estimated_credits`, the per-minute and
 * per-item pairs, and the "up to" columns, the fee applied as at publish (the
 * row's own monetization, `appListingPrice` / `appListingMaxColumns`).
 * workflow_templates (with `--include-templates`): `estimated_credits`,
 * `estimated_per_minute_credits` and the "up to" columns, unmarked. ONLY the
 * columns whose values differ — a second run prints every row as `=` and
 * writes nothing. It never touches `organization_approved_apps`: a price move
 * from this backfill does not clear an organization's approval. Built-in
 * templates are re-seeded from their docs, whose figures `template-listing-prices.test.ts`
 * holds to the metered listing.
 *
 * GATE. It refuses unless metered LLM pricing is live in its own process: the
 * Cloud edition, the R33 schema gate confirmed by a probe of THIS database
 * (`probeLlmMeteredSchemaNow` — a fresh process is "not ready" until it asks),
 * and the rollback switch off. Otherwise it would rewrite every listing to the
 * tier figures. `--allow-rollback` is the rollback path, and only it: it runs
 * only while `LLM_TIER_PRICING_ROLLBACK` is set (a database whose metered
 * schema is merely unconfirmed is refused either way), and the same recompute
 * then restores the tier figures.
 *
 * CANDIDATES. A graph with a node that makes a metered LLM call, or a UGC video
 * whose clip or creator part holds a reading. A template owned by the server's
 * own account (the tutorial seeder's built-in templates, R48) is never
 * written: the seeder rewrites it from its doc on every boot. A listing whose
 * graph names a metered model with no price (R49) is reported as skipped and
 * left as it is. Rows are read and priced a page at a time.
 *
 * CACHE. The app runner holds an app's row in an in-process cache for up to 30
 * minutes (`routes/app-runner.ts`); the gallery reads the table directly.
 *
 * ENVIRONMENT: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_ORCHESTRATOR_SECRET
 * (32+ characters), EDITION=cloud.
 *
 * Usage (dry run is the DEFAULT):
 *   cd backend && npm run backfill:llm-listing-prices -- --report ./llm-listing.json
 *   … -- --include-templates          # workflow_templates too
 *   … -- --apply                      # write the differing columns
 *   … -- --allow-rollback             # rollback: restore the tier figures (LLM_TIER_PRICING_ROLLBACK set)
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { supabase } from "../../lib/supabase.js"
import { config, hasCredits, llmMeteredPricing } from "../../lib/config.js"
import { isLlmUnpricedError } from "../../lib/llm-unpriced-refusal.js"
import { SYSTEM_ACCOUNT_EMAIL_PATTERN } from "../../lib/system-account.js"
import { ugcChains } from "@nodaro/render-rules"
import { probeLlmMeteredSchemaNow } from "../../lib/llm-metered-schema-gate.js"
import { resolveCanvasResultIds } from "../../lib/canvas-result-ids.js"
import { exposedListNodeIds, exposedMediaNodeIds, exposedTextCaps } from "../../lib/exposed-text-caps.js"
import { appListingMaxColumns, appListingPrice, type AppListingSplit } from "../../lib/app-listing-price.js"
import { MAX_COLUMNS } from "../../lib/listing-max-columns.js"
import { PER_MINUTE_COLUMNS } from "../../lib/listing-per-minute-columns.js"
import { LISTING_ESTIMATE_FLAG_COLUMN, estimateFlagColumn } from "../../lib/listing-estimate-flag-column.js"
import { estimateWorkflowListingCredits, nodeMakesMeteredLlmCall, type EstimateEdge, type EstimateNode, type ListingPublishType } from "../billing/credits.js"
import { usecaseViewerForEveryone } from "../../lib/use-case/inner-availability.js"
import { loadAvailabilityOverridesForScript } from "../../lib/availability-override.js"

// ---------------------------------------------------------------------------
// Pure parts (tested in __tests__/backfill-llm-listing-prices.test.ts)
// ---------------------------------------------------------------------------

type Columns = Record<string, number | boolean>
type GraphNode = { id?: string; type?: string; data?: Record<string, unknown> }

/** A listing as the publish path stores it: its two parts and, when computed, its "up to". */
export type StoredListing = AppListingSplit & { readonly ceiling?: AppListingSplit; readonly estimate?: boolean }

function graphNodes(snapshotNodes: unknown): GraphNode[] {
  return Array.isArray(snapshotNodes) ? (snapshotNodes.filter((n) => n && typeof n === "object") as GraphNode[]) : []
}

/** The UGC parts whose figure holds an LLM reading (a clip's speech check, the creator check). */
const UGC_PARTS_WITH_READINGS: ReadonlySet<string> = new Set(["clip", "creator"])

/**
 * A candidate's snapshot holds a node whose run makes a metered LLM call, or a
 * UGC video whose clip or creator part holds a reading — read whatever the
 * rollback switch says.
 */
export function hasMeteredLlmNode(snapshotNodes: unknown, snapshotEdges?: unknown): boolean {
  const nodes = graphNodes(snapshotNodes)
  if (nodes.some((n) => typeof n.type === "string" && nodeMakesMeteredLlmCall({ type: n.type, data: n.data }))) return true
  if (!nodes.some((n) => n.type === "ugc-clip")) return false
  const edges = (Array.isArray(snapshotEdges) ? snapshotEdges : []) as Parameters<typeof ugcChains>[1]
  const typed = nodes.flatMap((n) => (typeof n.id === "string" && typeof n.type === "string" ? [{ id: n.id, type: n.type, data: n.data ?? {} }] : []))
  return ugcChains(typed as Parameters<typeof ugcChains>[0], edges).some((c) => c.members.some((m) => m.part !== null && UGC_PARTS_WITH_READINGS.has(m.part)))
}

/** An app's / component's listing columns, priced as the publish route prices them (its own fee on the preview part). */
export function appListingColumns(
  row: { monetization_enabled: boolean | null; monetization_flat_fee: number | null; monetization_percent: number | null },
  listing: StoredListing,
): Columns {
  const monetization = { enabled: row.monetization_enabled === true, flatFee: row.monetization_flat_fee ?? 0, percent: row.monetization_percent ?? 0 }
  const from = appListingPrice(listing, monetization)
  return {
    base_estimated_credits: from.base,
    estimated_credits: from.estimated,
    base_per_minute_credits: from.basePerMinute,
    per_minute_credits: from.perMinute,
    base_per_item_credits: from.basePerItem,
    per_item_credits: from.perItem,
    ...appListingMaxColumns(listing.ceiling ?? listing, monetization),
    // The listing's own flag (R47): false under the rollback, where nothing is an estimate.
    ...estimateFlagColumn(listing),
  }
}

/** A template's: both parts unmarked (a template has no fee), and its ceiling's. */
export function templateListingColumns(listing: StoredListing): Columns {
  const ceiling = listing.ceiling ?? listing
  return {
    estimated_credits: listing.preview + listing.final,
    estimated_per_minute_credits: (listing.previewPerMinute ?? 0) + (listing.finalPerMinute ?? 0),
    max_estimated_credits: ceiling.preview + ceiling.final,
    max_estimated_per_minute_credits: (ceiling.previewPerMinute ?? 0) + (ceiling.finalPerMinute ?? 0),
    ...estimateFlagColumn(listing),
  }
}

/** The columns whose stored value differs, or null when the row already holds them all (idempotence). */
export function planListingWrite(stored: Readonly<Record<string, unknown>>, next: Readonly<Record<string, number | boolean>>): Record<string, number | boolean> | null {
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => stored[k] !== v))
  return Object.keys(changed).length > 0 ? changed : null
}

export interface LlmListingBackfillOptions {
  readonly apply: boolean
  readonly includeTemplates: boolean
  readonly allowRollback: boolean
  readonly report: string
}

/** Why the backfill refuses to price under the pricing state it finds — or null when it may run. */
export function pricingStateRefusal(state: { metered: boolean; rollbackSet: boolean; allowRollback: boolean }): string | null {
  if (state.metered) return null
  if (!state.allowRollback) {
    return "Refusing: metered LLM pricing is not live here (the metered schema is not confirmed on this database, or LLM_TIER_PRICING_ROLLBACK is set). The backfill would write tier figures; pass --allow-rollback only for the rollback path."
  }
  // --allow-rollback restores the tier figures ONLY under the rollback switch: a database whose
  // metered schema simply is not confirmed yet must never be rewritten to tier figures.
  if (!state.rollbackSet) {
    return "Refusing: --allow-rollback restores the tier figures only while LLM_TIER_PRICING_ROLLBACK is set. Metered pricing is off here because the metered schema is not confirmed on this database — run after the release's migrations apply."
  }
  return null
}

export function parseLlmListingArgs(argv: ReadonlyArray<string>): LlmListingBackfillOptions {
  const reportIdx = argv.indexOf("--report")
  const day = new Date().toISOString().slice(0, 10)
  return {
    apply: argv.includes("--apply"),
    includeTemplates: argv.includes("--include-templates"),
    allowRollback: argv.includes("--allow-rollback"),
    report: reportIdx !== -1 && argv[reportIdx + 1] ? argv[reportIdx + 1]! : `./llm-listing-backfill-${day}.json`,
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

// Run after migrations 483 (per minute / per item) and 517 ("up to") reach the database: it names them all.
// …and 553 (the estimate flag).
const APP_LISTING_COLUMNS = ["base_estimated_credits", "estimated_credits", ...PER_MINUTE_COLUMNS.published_apps, ...MAX_COLUMNS.published_apps, LISTING_ESTIMATE_FLAG_COLUMN]
const TEMPLATE_LISTING_COLUMNS = ["estimated_credits", ...PER_MINUTE_COLUMNS.workflow_templates, ...MAX_COLUMNS.workflow_templates, LISTING_ESTIMATE_FLAG_COLUMN]

const PAGE = 100

/** Each page of `table`, handed on as it is read: never every snapshot in memory at once. */
async function forEachPage(table: "published_apps" | "workflow_templates", columns: string, deletedFilter: boolean, visit: (rows: ListingRow[]) => Promise<void>): Promise<void> {
  for (let from = 0; ; ) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).range(from, from + PAGE - 1)
    if (deletedFilter) query = query.is("deleted_at", null)
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = (data ?? []) as unknown as ListingRow[]
    await visit(page)
    if (page.length < PAGE) return
    from += page.length
  }
}

/**
 * The server's own accounts (`system-account.ts`): a template they own is a
 * built-in one the tutorial seeder writes from its doc on every boot (R48) —
 * the doc's figure is held to the listing by `template-listing-prices.test.ts`,
 * and a write here would be overwritten. Null when they cannot be read.
 */
async function systemAccountIds(): Promise<ReadonlySet<string> | null> {
  const { data, error } = await supabase.from("profiles").select("id").like("email", SYSTEM_ACCOUNT_EMAIL_PATTERN)
  if (error) return null
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
}

/** The listing a republish of this row would store now. */
async function listingOf(row: ListingRow, publishType: ListingPublishType): Promise<StoredListing> {
  const settings = (row.snapshot_settings ?? {}) as Record<string, unknown>
  // The publish path, exactly: the snapshot's saved result ids resolved first.
  const nodes = (await resolveCanvasResultIds(graphNodes(row.snapshot_nodes) as never, row.creator_id, { settings })) as unknown as EstimateNode[]
  const edges = (Array.isArray(row.snapshot_edges) ? row.snapshot_edges : []) as EstimateEdge[]
  return estimateWorkflowListingCredits(nodes, edges, {
    publishType,
    speechTextCaps: exposedTextCaps(settings, nodes),
    replaceableMediaNodeIds: publishType === "template" ? exposedMediaNodeIds(null, nodes) : exposedMediaNodeIds(settings, nodes),
    ...(publishType === "template" ? {} : { exposedListNodeIds: exposedListNodeIds(settings, nodes) }),
    snapshotSettings: settings,
    // As a republish prices it: a general user's run (decided 2026-10-20).
    ...usecaseViewerForEveryone(nodes),
  })
}

export async function runLlmListingBackfill(
  opts: LlmListingBackfillOptions,
): Promise<{ ok: boolean; rows: number; changed: number; written: number; skipped?: number }> {
  const refused = { ok: false, rows: 0, changed: 0, written: 0 }
  if (!hasCredits()) {
    console.error("Refusing: this environment is not the Cloud edition (set EDITION=cloud). Outside it the estimate prices unmarked and without the admin price overrides.")
    return refused
  }
  // A fresh process has not asked the database yet: ask it, so "metered" below is this database's answer.
  await probeLlmMeteredSchemaNow()
  const metered = llmMeteredPricing()
  const refusal = pricingStateRefusal({ metered, rollbackSet: config.LLM_TIER_PRICING_ROLLBACK, allowRollback: opts.allowRollback })
  if (refusal) {
    console.error(refusal)
    return refused
  }
  // A listing is priced as a general user's run (usecaseViewerForEveryone): read the deployment's
  // availability first — a cold cache would read Speaker Map and Speaker Frames as released.
  if (!(await loadAvailabilityOverridesForScript())) {
    console.error("Refusing: the deployment's availability (Admin → Availability) could not be read. Without it a node hidden from users reads as released, and a listing would be priced as their run is not.")
    return refused
  }
  console.log(`[llm-listing-backfill] mode=${opts.apply ? "APPLY" : "dry run"} pricing=${metered ? "metered" : "tier (rollback)"} templates=${opts.includeTemplates ? "yes" : "no"}`)
  const report: Array<{ table: string; slug: string; before: Record<string, unknown>; after?: Columns; changed: boolean; skipped?: string }> = []
  let written = 0

  const visit = async (table: "published_apps" | "workflow_templates", row: ListingRow, columns: readonly string[], price: () => Promise<Columns>) => {
    let after: Columns
    try {
      after = await price()
    } catch (err) {
      // A metered model with no price (R49): its listing cannot be priced — reported and left as it is.
      if (!isLlmUnpricedError(err)) throw err
      report.push({ table, slug: row.slug, before: Object.fromEntries(columns.map((c) => [c, row[c]])), changed: false, skipped: `llm_model_unpriced: ${err.modelId}` })
      console.warn(`${row.slug} · ${table} · SKIPPED: model ${err.modelId} has no price (llm_model_unpriced)`)
      return
    }
    const write = planListingWrite(row, after)
    const before = Object.fromEntries(columns.map((c) => [c, row[c]]))
    report.push({ table, slug: row.slug, before, after, changed: write !== null })
    console.log(`${row.slug} · ${table} · listed ${String(before.estimated_credits)} ${write ? "→" : "="} ${after.estimated_credits}`)
    if (write && opts.apply) {
      const { error } = await supabase.from(table).update(write).eq("id", row.id)
      if (error) throw new Error(`${table} ${row.slug}: ${error.message}`)
      written += 1
    }
  }

  await forEachPage(
    "published_apps",
    `id, slug, creator_id, publish_type, snapshot_nodes, snapshot_edges, snapshot_settings, monetization_enabled, monetization_flat_fee, monetization_percent, ${APP_LISTING_COLUMNS.join(", ")}`,
    true,
    async (page) => {
      for (const row of page.filter((r) => hasMeteredLlmNode(r.snapshot_nodes, r.snapshot_edges))) {
        const publishType: ListingPublishType = row.publish_type === "component" ? "component" : "app"
        await visit("published_apps", row, APP_LISTING_COLUMNS, async () => appListingColumns(row as never, await listingOf(row, publishType)))
      }
    },
  )

  if (opts.includeTemplates) {
    const system = await systemAccountIds()
    if (!system) {
      console.error("Refusing the templates: the server's own accounts could not be read, so the seeded built-in templates (R48) cannot be told apart.")
      return { ok: false, rows: report.length, changed: report.filter((r) => r.changed).length, written }
    }
    await forEachPage(
      "workflow_templates",
      `id, slug, creator_id, snapshot_nodes, snapshot_edges, snapshot_settings, ${TEMPLATE_LISTING_COLUMNS.join(", ")}`,
      false,
      async (page) => {
        for (const row of page.filter((r) => !system.has(r.creator_id) && hasMeteredLlmNode(r.snapshot_nodes, r.snapshot_edges))) {
          await visit("workflow_templates", row, TEMPLATE_LISTING_COLUMNS, async () => templateListingColumns(await listingOf(row, "template")))
        }
      },
    )
  }

  const changed = report.filter((r) => r.changed).length
  const skipped = report.filter((r) => r.skipped).length
  console.log(`[llm-listing-backfill] ${report.length} row(s), ${changed} differ, ${skipped} skipped (unpriced model)${opts.apply ? `, ${written} written` : " (dry run — nothing written)"}`)
  writeFileSync(opts.report, JSON.stringify({ generatedAt: new Date().toISOString(), apply: opts.apply, metered, rows: report }, null, 2))
  console.log(`[llm-listing-backfill] report: ${opts.report}`)
  return { ok: true, rows: report.length, changed, written, skipped }
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  runLlmListingBackfill(parseLlmListingArgs(process.argv.slice(2)))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}

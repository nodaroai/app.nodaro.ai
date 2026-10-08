/**
 * Recompute the stored price of every published app (and component) with a
 * speech node, for the production flip of length-based speech pricing
 * (decided 2026-10-06). Templates join only with `--include-templates`.
 *
 * WHY. A published app's listed price (`estimated_credits`, with
 * `base_estimated_credits` under the creator's markup) is computed ONCE, at
 * publish. Apps published while speech was flat per request advertise the
 * flat row; once the server prices speech by length they would under-advertise
 * a long text and over-advertise a short one until their next republish. This
 * script recomputes each candidate's listing estimate exactly as a republish
 * does — `resolveCanvasResultIds` then `estimateWorkflowListingCredits` (the
 * whole graph at Preview plus each Render final) with the app's exposed text
 * inputs (`speechTextCaps`) — so a
 * non-speech price change since publish moves too (decided 2026-10-06: the
 * dry run lists every delta, so the owner sees it before anything is written).
 *
 * WHAT IT WRITES. `base_estimated_credits` and `estimated_credits` (the latter
 * through `calculateMonetizedCost` when the app is monetized, mirroring the
 * publish route), ONLY on rows whose values differ — a second run
 * still prints every candidate, each marked `=`, and writes nothing. It never touches `organization_approved_apps`: a price rise from
 * this backfill does NOT clear an organization's approval (the PATCH route's
 * revoke is never on this path). Every write is logged with before/after.
 *
 * GATE. It refuses to start unless SPEECH_LENGTH_PRICING_ENABLED is on in its
 * own environment — it must price what the flipped server charges.
 * `--allow-flag-off` exists for the rollback path only: with the flag off the
 * same recompute restores today's flat-row prices.
 *
 * CACHE. The app runner holds an app's row in an in-process cache for up to 30
 * minutes (`routes/app-runner.ts`, `APP_CACHE_TTL_MS`), which this script
 * cannot reach: the runner may show the old price for that long after
 * `--apply`, or until the API restarts; the gallery reads the table directly.
 *
 * ENVIRONMENT (all required; the script reads the real configuration module,
 * which refuses to load without them): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * INTERNAL_ORCHESTRATOR_SECRET (32 characters or more), EDITION=cloud (the
 * script refuses on any other edition: the estimate would price unmarked and
 * without the admin price overrides), SPEECH_LENGTH_PRICING_ENABLED=true.
 *
 * Usage (dry run is the DEFAULT — it prints one line per candidate, writes the
 * same as JSON, and changes nothing):
 *   cd backend && npm run backfill:speech-app-prices -- --report ./speech-backfill.json
 *   … -- --include-templates          # workflow_templates too
 *   … -- --apply                      # write the differing rows
 *   … -- --allow-flag-off             # rollback: recompute with the flag off
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { supabase } from "../../lib/supabase.js"
import { hasCredits, speechLengthPricingEnabled } from "../../lib/config.js"
import { resolveCanvasResultIds } from "../../lib/canvas-result-ids.js"
import { exposedListNodeIds, exposedMediaNodeIds, exposedTextCaps } from "../../lib/exposed-text-caps.js"
import { appListingPrice, type AppListingSplit } from "../../lib/app-listing-price.js"
import { SPEECH_NODE_TYPES, speechEstimate, upstreamSpeechText } from "../../lib/speech-estimate.js"
import { estimateWorkflowListingCredits, type EstimateEdge, type EstimateNode, type ListingPublishType } from "../billing/credits.js"

// ---------------------------------------------------------------------------
// Pure parts (tested in __tests__/backfill-speech-app-prices.test.ts)
// ---------------------------------------------------------------------------

export interface AppRow {
  readonly id: string
  readonly slug: string
  readonly publish_type: string
  readonly creator_id: string
  readonly snapshot_nodes: unknown
  readonly snapshot_edges: unknown
  readonly snapshot_settings: unknown
  readonly base_estimated_credits: number | null
  readonly estimated_credits: number | null
  readonly monetization_enabled: boolean | null
  readonly monetization_flat_fee: number | null
  readonly monetization_percent: number | null
}

export interface TemplateRow {
  readonly id: string
  readonly slug: string
  readonly creator_id: string
  readonly snapshot_nodes: unknown
  readonly snapshot_edges: unknown
  readonly snapshot_settings: unknown
  readonly estimated_credits: number | null
}

type GraphNode = { id?: string; type?: string; data?: Record<string, unknown> }

export function graphNodes(snapshotNodes: unknown): GraphNode[] {
  return Array.isArray(snapshotNodes) ? (snapshotNodes.filter((n) => n && typeof n === "object") as GraphNode[]) : []
}

/** A row is a candidate when its snapshot holds a Text to Speech or Text to Dialogue node. */
export function hasSpeechNode(snapshotNodes: unknown): boolean {
  return graphNodes(snapshotNodes).some((n) => typeof n.type === "string" && SPEECH_NODE_TYPES.has(n.type))
}

export function selectCandidates<T extends { snapshot_nodes: unknown }>(rows: ReadonlyArray<T>): T[] {
  return rows.filter((row) => hasSpeechNode(row.snapshot_nodes))
}

export interface Price {
  readonly base: number
  readonly listed: number
}

/** The stored pair from the listing's two parts, the way the publish route derives it (the fee on the preview part only; the final part unmarked). */
export function recomputePrice(row: Pick<AppRow, "monetization_enabled" | "monetization_flat_fee" | "monetization_percent">, split: AppListingSplit): Price {
  const { base, estimated } = appListingPrice(split, { enabled: row.monetization_enabled === true, flatFee: row.monetization_flat_fee ?? 0, percent: row.monetization_percent ?? 0 })
  return { base, listed: estimated }
}

/**
 * A listing with a part per minute of the episode (decided 2026-10-07) is not
 * backfilled: this script writes the fixed pair only, and a fixed price
 * without its per-minute part would under-quote. Its next publish stores both.
 */
export function hasPerMinutePart(split: AppListingSplit): boolean {
  // A per-item part (decided 2026-10-07) is skipped the same way: this script writes the fixed pair alone.
  return (split.previewPerMinute ?? 0) + (split.finalPerMinute ?? 0) + (split.previewPerItem ?? 0) + (split.finalPerItem ?? 0) > 0
}

/** The note a skipped per-minute listing carries in the report. */
export const PER_MINUTE_SKIP_NOTE = "per-minute listing: left for its next publish"

export interface PlannedWrite {
  readonly id: string
  readonly slug: string
  readonly before: Price
  readonly after: Price
}

/** The write for a row, or null when both stored values already equal the recomputed ones (idempotence). */
export function planWrite(row: Pick<AppRow, "id" | "slug" | "base_estimated_credits" | "estimated_credits">, after: Price): PlannedWrite | null {
  const before: Price = { base: row.base_estimated_credits ?? 0, listed: row.estimated_credits ?? 0 }
  if (before.base === after.base && before.listed === after.listed) return null
  return { id: row.id, slug: row.slug, before, after }
}

/**
 * The speech nodes of a snapshot, each with how its text is priced — exact
 * (literal text) or unknown (a connected, referenced, mapped or exposed text
 * priced at its limit or the model's cap). Read with the flag's state: with
 * the flag off every node reads "flat".
 */
export function speechNodeSummary(snapshotNodes: unknown, snapshotEdges: unknown, caps: Readonly<Record<string, number | null>>): string {
  const nodes = graphNodes(snapshotNodes)
  const edges = Array.isArray(snapshotEdges) ? (snapshotEdges as Array<{ source?: string; target: string; targetHandle?: string | null }>) : []
  return nodes
    .filter((n) => typeof n.type === "string" && SPEECH_NODE_TYPES.has(n.type))
    .map((n) => {
      const est = speechEstimate(n.type!, n.data ?? {}, upstreamSpeechText(n, nodes, edges, caps))
      return `${n.type}:${est ? (est.exact ? `exact(${est.chars})` : `unknown(${est.chars})`) : "flat"}`
    })
    .join(" ")
}

export interface CandidateLine {
  readonly kind: "app" | "component" | "template"
  readonly id: string
  readonly slug: string
  readonly monetized: boolean
  readonly before: Price
  readonly after: Price
  readonly changed: boolean
  readonly speech: string
}

export function formatLine(line: CandidateLine): string {
  const arrow = line.changed ? "→" : "="
  return `${line.slug} · ${line.kind} · base ${line.before.base} ${arrow} ${line.after.base} · listed ${line.before.listed} ${arrow} ${line.after.listed} · ${line.monetized ? "monetized" : "free"} · ${line.speech}`
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface BackfillOptions {
  readonly apply: boolean
  readonly includeTemplates: boolean
  readonly allowFlagOff: boolean
  readonly report: string
}

async function readAll<T>(table: string, columns: string, filter?: (q: ReturnType<typeof supabase.from> extends { select: (c: string) => infer R } ? R : never) => unknown): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; ) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).range(from, from + 999)
    if (filter) query = filter(query as never) as typeof query
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
    from += page.length
  }
}

async function recomputeListing(
  row: { creator_id: string; snapshot_nodes: unknown; snapshot_edges: unknown; snapshot_settings: unknown },
  publishType: ListingPublishType,
): Promise<{ split: AppListingSplit; caps: Readonly<Record<string, number | null>>; nodes: GraphNode[] }> {
  const settings = (row.snapshot_settings ?? {}) as Record<string, unknown>
  // The publish path, exactly: the snapshot's saved result ids resolved first.
  const nodes = (await resolveCanvasResultIds(graphNodes(row.snapshot_nodes), row.creator_id, { settings })) as GraphNode[]
  const edges = (Array.isArray(row.snapshot_edges) ? row.snapshot_edges : []) as EstimateEdge[]
  const caps = exposedTextCaps(settings, nodes)
  const split = await estimateWorkflowListingCredits(nodes as EstimateNode[], edges, {
    publishType,
    speechTextCaps: caps,
    replaceableMediaNodeIds: exposedMediaNodeIds(settings, nodes),
    exposedListNodeIds: exposedListNodeIds(settings, nodes),
  })
  return { split, caps, nodes }
}

export async function runBackfill(opts: BackfillOptions): Promise<{ ok: boolean; lines: CandidateLine[] }> {
  // The listing estimate reads the charged price table (admin price overrides,
  // the service markup) only on the Cloud edition; anywhere else it prices
  // unmarked, from the static table, and the owner would approve (and --apply
  // would write) prices below what the Cloud server charges. No rollback path
  // lifts this.
  if (!hasCredits()) {
    console.error("Refusing: this environment is not the Cloud edition (set EDITION=cloud). Outside it the estimate prices speech and every other node unmarked and without the admin price overrides, which is lower than what the Cloud server charges.")
    return { ok: false, lines: [] }
  }
  if (!speechLengthPricingEnabled() && !opts.allowFlagOff) {
    console.error("Refusing: SPEECH_LENGTH_PRICING_ENABLED is not on in this environment. The backfill prices what the flipped server charges; pass --allow-flag-off only for the rollback path.")
    return { ok: false, lines: [] }
  }
  console.log(`[backfill] mode=${opts.apply ? "APPLY" : "dry run"} edition=cloud flag=${speechLengthPricingEnabled() ? "on" : "off"} templates=${opts.includeTemplates ? "yes" : "no"}`)

  const lines: CandidateLine[] = []
  const appRows = await readAll<AppRow>(
    "published_apps",
    "id, slug, publish_type, creator_id, snapshot_nodes, snapshot_edges, snapshot_settings, base_estimated_credits, estimated_credits, monetization_enabled, monetization_flat_fee, monetization_percent",
    (q) => (q as { is: (c: string, v: null) => unknown }).is("deleted_at", null),
  )
  for (const row of selectCandidates(appRows)) {
    const publishType: ListingPublishType = row.publish_type === "component" ? "component" : "app"
    const { split, caps, nodes } = await recomputeListing(row, publishType)
    const after = recomputePrice(row, split)
    const perMinute = hasPerMinutePart(split)
    const write = perMinute ? null : planWrite(row, after)
    const line: CandidateLine = {
      kind: row.publish_type === "component" ? "component" : "app",
      id: row.id,
      slug: row.slug,
      monetized: row.monetization_enabled === true,
      before: { base: row.base_estimated_credits ?? 0, listed: row.estimated_credits ?? 0 },
      after,
      changed: write !== null,
      speech: `${speechNodeSummary(nodes, row.snapshot_edges, caps)}${perMinute ? ` · ${PER_MINUTE_SKIP_NOTE}` : ""}`,
    }
    lines.push(line)
    console.log(formatLine(line))
    if (write && opts.apply) {
      const { error } = await supabase
        .from("published_apps")
        .update({ base_estimated_credits: after.base, estimated_credits: after.listed })
        .eq("id", row.id)
      if (error) throw new Error(`published_apps ${row.slug}: ${error.message}`)
      console.log(`  wrote ${row.slug}: base ${write.before.base} → ${write.after.base}, listed ${write.before.listed} → ${write.after.listed}`)
    }
  }

  if (opts.includeTemplates) {
    const templateRows = await readAll<TemplateRow>("workflow_templates", "id, slug, creator_id, snapshot_nodes, snapshot_edges, snapshot_settings, estimated_credits")
    for (const row of selectCandidates(templateRows)) {
      const { split, caps, nodes } = await recomputeListing(row, "template")
      // A template is not monetized: its listed price is both parts, unmarked.
      const listed = split.preview + split.final
      const after: Price = { base: listed, listed }
      const before: Price = { base: row.estimated_credits ?? 0, listed: row.estimated_credits ?? 0 }
      const perMinute = hasPerMinutePart(split)
      const changed = !perMinute && before.listed !== after.listed
      const speech = `${speechNodeSummary(nodes, row.snapshot_edges, caps)}${perMinute ? ` · ${PER_MINUTE_SKIP_NOTE}` : ""}`
      const line: CandidateLine = { kind: "template", id: row.id, slug: row.slug, monetized: false, before, after, changed, speech }
      lines.push(line)
      console.log(formatLine(line))
      if (changed && opts.apply) {
        const { error } = await supabase.from("workflow_templates").update({ estimated_credits: after.listed }).eq("id", row.id)
        if (error) throw new Error(`workflow_templates ${row.slug}: ${error.message}`)
        console.log(`  wrote ${row.slug}: ${before.listed} → ${after.listed}`)
      }
    }
  }

  const changed = lines.filter((l) => l.changed)
  console.log(`[backfill] ${lines.length} candidate(s), ${changed.length} differ${opts.apply ? ", written" : " (dry run — nothing written)"}`)
  writeFileSync(opts.report, JSON.stringify({ generatedAt: new Date().toISOString(), apply: opts.apply, flagOn: speechLengthPricingEnabled(), lines }, null, 2))
  console.log(`[backfill] report: ${opts.report}`)
  return { ok: true, lines }
}

export function parseArgs(argv: ReadonlyArray<string>): BackfillOptions {
  const reportIdx = argv.indexOf("--report")
  const day = new Date().toISOString().slice(0, 10)
  return {
    apply: argv.includes("--apply"),
    includeTemplates: argv.includes("--include-templates"),
    allowFlagOff: argv.includes("--allow-flag-off"),
    report: reportIdx !== -1 && argv[reportIdx + 1] ? argv[reportIdx + 1]! : `./speech-price-backfill-${day}.json`,
  }
}

const invokedDirectly = typeof process.argv[1] === "string" && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  runBackfill(parseArgs(process.argv.slice(2)))
    .then((r) => {
      if (!r.ok) process.exitCode = 1
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}

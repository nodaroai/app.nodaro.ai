// @reads backend/src/lib/tutorial-seed/templates/** backend/src/lib/tutorial-seed/__tests__/fixtures/template-listing-prices-rollback.json backend/src/ee/billing/docs-price-settings.json
/**
 * The listed price every built-in template stores, against the charged price
 * (see src/ee/billing/template-card-prices.ts).
 *
 *   npx tsx scripts/template-prices.ts          every stored card figure vs the charged listing; exit 1 on a mismatch
 *   npx tsx scripts/template-prices.ts --fix    write the charged listing into every built-in template
 *
 * Run it after a reprice (a migration, a STATIC_CREDIT_COSTS row, a change to
 * docs-price-settings.json or its `charged` snapshot) or a change to a
 * template's graph. The docs quote the podcast cards; `preview-gate-docs.test.ts`
 * reads the figures from the templates and names each sentence to update.
 * `template-listing-prices.test.ts` fails a stored figure that differs.
 *
 * Needs the same stub env as gen:skills to import the billing module
 * (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_ORCHESTRATOR_SECRET); it
 * reads no database.
 *
 * A template that holds a UGC video is priced by the UGC estimate, through the
 * private plugin, and is left as it is (`ugc-templates.test.ts`). The
 * tier-pricing rollback's figures (`fixtures/template-listing-prices-rollback.json`)
 * are written too, for the templates whose listing the rollback moves.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const fix = process.argv.slice(2).includes("--fix")

// A card is priced as the hosted deployment charges (docs/deployment.md): speech by length, LLM
// calls metered per model on Nodaro Cloud. Set before the billing module (and the config it parses
// at import) loads, whatever the shell's .env says.
process.env.SPEECH_LENGTH_PRICING_ENABLED = "true"
process.env.EDITION = "cloud"
delete process.env.LLM_TIER_PRICING_ROLLBACK
// …with the metered LLM schema applied: the R33 gate is not asked of a database.
const { assumeLlmMeteredSchemaReadyForDocs } = await import("../src/lib/llm-metered-schema-gate.js")
assumeLlmMeteredSchemaReadyForDocs()
const { config } = await import("../src/lib/config.js")
const { templateCardPrices, pricedByTheUgcEstimate } = await import("../src/ee/billing/template-card-prices.js")
type TemplateCardPrice = ReturnType<typeof templateCardPrices>["authored"]

const TEMPLATES_DIR = fileURLToPath(new URL("../src/lib/tutorial-seed/templates/", import.meta.url))
const ROLLBACK_FILE = fileURLToPath(new URL("../src/lib/tutorial-seed/__tests__/fixtures/template-listing-prices-rollback.json", import.meta.url))

type Doc = {
  nodes: unknown[]
  edges: unknown[]
  estimatedCredits?: number
  estimatedPerMinuteCredits?: number
  estimatedCreditsIsEstimate?: boolean
  withoutPreviewStopRule?: { estimatedCredits: number; estimatedPerMinuteCredits?: number }
}

const withRollback = <T>(on: boolean, f: () => T): T => {
  const cfg = config as { LLM_TIER_PRICING_ROLLBACK: boolean }
  const was = cfg.LLM_TIER_PRICING_ROLLBACK
  cfg.LLM_TIER_PRICING_ROLLBACK = on
  try {
    return f()
  } finally {
    cfg.LLM_TIER_PRICING_ROLLBACK = was
  }
}

/** `doc` with a card's figures written in, keys in their place (a key the doc lacks is added after the last price key). */
function written(doc: Doc, price: TemplateCardPrice): Doc {
  const next: Record<string, unknown> = { ...doc, estimatedCredits: price.estimatedCredits }
  if (price.estimatedPerMinuteCredits !== undefined) next.estimatedPerMinuteCredits = price.estimatedPerMinuteCredits
  else delete next.estimatedPerMinuteCredits
  return next as Doc
}

const show = (fixed: number | undefined, perMinute: number | undefined) => `${fixed ?? "-"}${perMinute ? ` + ${perMinute}/min` : ""}`

const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json")).sort()
const ROLLBACK_COMMENT =
  "Built-in templates whose listing differs under the tier-pricing rollback (LLM_TIER_PRICING_ROLLBACK): each one's card as the rollback derives it, at the charged prices (src/ee/billing/template-card-prices.ts). A template not listed here derives the same figure either way. Written by backend/scripts/template-prices.ts --fix."
const rollbackFigures: Record<string, { estimatedCredits: number }> = {}
const changed: string[] = []

for (const file of files) {
  const path = join(TEMPLATES_DIR, file)
  const text = readFileSync(path, "utf8")
  const doc = JSON.parse(text) as Doc
  if (doc.estimatedCredits === undefined || pricedByTheUgcEstimate(doc)) continue
  const prices = templateCardPrices(doc as Parameters<typeof templateCardPrices>[0])
  if (prices.authored.estimate !== (doc.estimatedCreditsIsEstimate === true)) {
    changed.push(`${file}: estimatedCreditsIsEstimate ${doc.estimatedCreditsIsEstimate === true} → ${prices.authored.estimate}`)
  }
  let next = written(doc, prices.authored)
  if (prices.authored.estimate) next = { ...next, estimatedCreditsIsEstimate: true }
  else delete next.estimatedCreditsIsEstimate
  const before = [show(doc.estimatedCredits, doc.estimatedPerMinuteCredits)]
  const after = [show(prices.authored.estimatedCredits, prices.authored.estimatedPerMinuteCredits)]
  if (doc.withoutPreviewStopRule && prices.withoutPreviewStopRule) {
    const off = prices.withoutPreviewStopRule
    const gate: Record<string, unknown> = { ...doc.withoutPreviewStopRule, estimatedCredits: off.estimatedCredits, estimatedPerMinuteCredits: off.estimatedPerMinuteCredits }
    if (off.estimatedPerMinuteCredits === undefined) delete gate.estimatedPerMinuteCredits
    next = { ...next, withoutPreviewStopRule: gate as NonNullable<Doc["withoutPreviewStopRule"]> }
    before.push(`off ${show(doc.withoutPreviewStopRule.estimatedCredits, doc.withoutPreviewStopRule.estimatedPerMinuteCredits)}`)
    after.push(`off ${show(off.estimatedCredits, off.estimatedPerMinuteCredits)}`)
  }
  // The rollback's figure, kept only where it moves the listing (a template with an LLM node).
  const tier = withRollback(true, () => templateCardPrices(doc as Parameters<typeof templateCardPrices>[0]).authored)
  if (tier.estimatedCredits !== prices.authored.estimatedCredits) rollbackFigures[file] = { estimatedCredits: tier.estimatedCredits }
  const out = JSON.stringify(next, null, 2) + (text.endsWith("\n") ? "\n" : "")
  if (out !== text) {
    changed.push(`${file}: ${before.join(", ")} → ${after.join(", ")}`)
    if (fix) writeFileSync(path, out)
  }
}

const rollbackOut = JSON.stringify({ _comment: ROLLBACK_COMMENT, templates: rollbackFigures }, null, 2) + "\n"
if (rollbackOut !== readFileSync(ROLLBACK_FILE, "utf8")) {
  changed.push("fixtures/template-listing-prices-rollback.json: the rollback's figures")
  if (fix) writeFileSync(ROLLBACK_FILE, rollbackOut)
}

for (const line of changed) console.log(line)
if (changed.length === 0) console.log("Every built-in template lists its charged price.")
else if (fix) console.log(`\nWrote ${changed.length} change(s). Then: npm run docs:prices -- --fix, and re-read each sentence a figure moved in.`)
else {
  console.log(`\n${changed.length} stored figure(s) differ from the charged listing: npx tsx scripts/template-prices.ts --fix`)
  process.exitCode = 1
}

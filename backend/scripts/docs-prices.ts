/**
 * The public docs' prices against the charged price (see scripts/lib/docs-prices.ts).
 *
 *   npm run docs:prices                 every annotated figure vs the charged price; exit 1 on a mismatch
 *   npm run docs:prices -- --fix        rewrite every annotated figure to the charged price
 *   npm run docs:prices -- --base       the same check before any pricing settings apply (the price-table
 *                                       rows) — for checking which id a figure was priced from
 *   npm run docs:prices -- --live <url> every annotated figure vs a running deployment's
 *                                       POST /v1/credits/model-costs (read-only)
 *   npm run docs:prices -- --live <url> --write
 *                                       THE REFRESH PATH for docs-price-settings.json's `charged`
 *                                       snapshot: prices every STATIC_CREDIT_COSTS id (and every
 *                                       plugin-priced id a page quotes) on the deployment, and
 *                                       records exactly the ones it charges differently from the
 *                                       in-repo rule — an admin's runtime reprice or a plugin's
 *                                       price — dropping entries that now agree. Then run `--fix`
 *                                       and `gen:skills`, so docs, skills and MCP hints follow.
 *
 * The in-repo price is STATIC_CREDIT_COSTS charged at docs-price-settings.json by the server's own
 * price-table rule (chargedPriceTableFrom). Needs the same stub env as gen:skills to import the billing module.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  DOCS_PRICE_SETTINGS_FILE,
  REPO_ROOT,
  annotationIds,
  docsPricing,
  listPricedPages,
  loadDocsPriceSettings,
  priceOf,
  readDocFigures,
  rewriteDocFigures,
  type Annotation,
  type DocFigure,
} from "./lib/docs-prices.js"

const args = process.argv.slice(2)
const fix = args.includes("--fix")
const write = args.includes("--write")
const base = args.includes("--base")
const liveAt = args.indexOf("--live")
const liveUrl = liveAt >= 0 ? args[liveAt + 1] : undefined

// The docs describe the hosted deployment, where speech is priced by length. Set before the billing
// module (and the config it parses at import) loads.
process.env.SPEECH_LENGTH_PRICING_ENABLED ??= "true"
const { unitQuoteCreditId } = await import("@nodaro/shared")
const { STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom } = await import("../src/ee/billing/credits.js")

const settings = base ? { cost_markup_percent: 0, service_margin_percent: {}, charged: {} } : loadDocsPriceSettings()
const table = chargedPriceTableFrom(new Map(), settings)
const { chargeOf, rateOf } = docsPricing(table, chargedCredits, settings.charged)
const valueOf = (a: Annotation) => priceOf(a, chargeOf, rateOf)
// The same figure before any pricing settings: a page still quoting the row is told so.
const rows = docsPricing(chargedPriceTableFrom(new Map(), { cost_markup_percent: 0, service_margin_percent: {} }), chargedCredits, {})
const rowOf = (a: Annotation) => {
  try {
    return priceOf(a, rows.chargeOf, rows.rateOf)
  } catch {
    return undefined
  }
}

async function livePrices(url: string, ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/credits/model-costs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: ids.slice(i, i + 50) }),
    })
    if (!res.ok) throw new Error(`${url}: POST /v1/credits/model-costs → ${res.status}`)
    Object.assign(out, ((await res.json()) as { data: Record<string, number> }).data)
  }
  return out
}

/** A term's id as the live endpoint prices it: a whole-run quote id for more than one unit. */
const liveId = (id: string, units: number) => (units === 1 ? id : unitQuoteCreditId(id, units))

/**
 * Rewrites the `charged` snapshot from the deployment at `url`: every id the deployment prices
 * differently from the in-repo rule (STATIC_CREDIT_COSTS at the file's settings), plus the
 * plugin-priced ids the pages quote. The pricing settings themselves are admin-only and are not
 * read from a deployment; the file states them.
 */
async function refreshSnapshot(url: string, all: DocFigure[]): Promise<void> {
  const current = loadDocsPriceSettings()
  const rule = chargedPriceTableFrom(new Map(), current)
  const quoted = new Set<string>()
  for (const f of all) {
    if (f.annotation.kind !== "charge") continue
    for (const c of f.annotation.charges) if (c.parts.length === 1 && c.parts[0]!.units === 1) quoted.add(c.parts[0]!.id!)
  }
  const repoIds = Object.keys(STATIC_CREDIT_COSTS).filter((id) => typeof STATIC_CREDIT_COSTS[id] === "number")
  // Every quoted id too: one the repo builds (a per-minute quote id) or cannot price at all (a plugin's).
  const ids = [...new Set([...repoIds, ...quoted, ...Object.keys(current.charged)])]
  const live = await livePrices(url, ids)
  const charged: Record<string, number> = {}
  for (const id of ids) {
    const deployed = live[id]
    if (deployed === undefined) continue
    const inRepo = chargedCredits(rule, id)
    // A repo-priced id is recorded only where the deployment differs; one the repo cannot price, only while a page quotes it.
    if (inRepo === undefined ? quoted.has(id) : deployed !== inRepo) charged[id] = deployed
  }
  const sorted = Object.fromEntries(Object.entries(charged).sort(([a], [b]) => a.localeCompare(b)))
  const raw = JSON.parse(readFileSync(DOCS_PRICE_SETTINGS_FILE, "utf8")) as Record<string, unknown>
  writeFileSync(DOCS_PRICE_SETTINGS_FILE, `${JSON.stringify({ ...raw, charged: sorted }, null, 2)}\n`)
  const was = current.charged
  const added = Object.keys(sorted).filter((id) => was[id] !== sorted[id])
  const dropped = Object.keys(was).filter((id) => sorted[id] === undefined)
  console.log(`[docs-prices] charged snapshot: ${Object.keys(sorted).length} ids (${added.length} set: ${added.join(", ") || "none"}; ${dropped.length} dropped: ${dropped.join(", ") || "none"})`)
  console.log("[docs-prices] next: npm run docs:prices -- --fix, then npm run gen:skills")
}

async function main() {
  const pages = listPricedPages()
  let mismatches = 0
  let unpriced = 0
  let figures = 0
  const all = pages.flatMap((file) => readDocFigures(file, readFileSync(join(REPO_ROOT, file), "utf8")))

  if (write) {
    if (!liveUrl) throw new Error("--write refreshes the snapshot from a deployment: pass --live <url>")
    await refreshSnapshot(liveUrl, all)
    return
  }

  let live: Record<string, number> | undefined
  if (liveUrl) {
    const ids = new Set<string>()
    for (const f of all) {
      if (f.annotation.kind === "charge") for (const c of f.annotation.charges) if (c.parts.length === 1) ids.add(liveId(c.parts[0]!.id!, c.parts[0]!.units))
      if (f.annotation.kind === "rate") ids.add(f.annotation.id)
    }
    live = await livePrices(liveUrl, [...ids])
  }

  for (const f of all) {
    if (f.annotation.kind === "none") continue
    figures++
    let expected: number | undefined
    if (live) {
      if (f.annotation.kind === "rate") {
        // Live answers one unit rounded up; the page states the exact rate.
        const one = f.annotation.units === 1 ? live[f.annotation.id] : undefined
        if (one !== undefined && Math.ceil(f.figure) !== one) {
          mismatches++
          console.log(`${f.file}:${f.line}  rate ${f.figure} (rounds to ${Math.ceil(f.figure)}) vs live one unit ${one}  ${f.source}`)
        }
        continue
      }
      // A charge of several parts has no single id a deployment prices; it is checked in-repo only.
      if (f.annotation.charges.some((c) => c.parts.length !== 1)) continue
      const parts = f.annotation.charges.map((c) => live![liveId(c.parts[0]!.id!, c.parts[0]!.units)])
      expected = parts.some((p) => p === undefined)
        ? undefined
        : f.annotation.charges.reduce((sum, c, k) => sum + c.count * parts[k]!, 0)
    } else {
      expected = valueOf(f.annotation)
    }
    if (expected === undefined) {
      unpriced++
      console.log(`${f.file}:${f.line}  ${live ? "no live price for" : "not priced here"}: ${annotationIds(f.annotation).join(", ")}  ${f.source}`)
    } else if (expected !== f.figure) {
      mismatches++
      const stale = !live && !base && rowOf(f.annotation) === f.figure ? " (the page quotes the row)" : ""
      console.log(`${f.file}:${f.line}  page ${f.figure}, ${live ? "live" : base ? "row" : "charged"} ${expected}${stale}  ${f.source}`)
    }
  }

  if (fix) {
    for (const file of pages) {
      const path = join(REPO_ROOT, file)
      const text = readFileSync(path, "utf8")
      const next = rewriteDocFigures(text, valueOf)
      if (next !== text) writeFileSync(path, next)
    }
    console.log("[docs-prices] rewrote the annotated figures to the charged price")
    return
  }
  console.log(`[docs-prices] ${figures} figures, ${mismatches} mismatched, ${unpriced} ${live ? "with no live price (a scaled rate the deployment quotes no id for)" : "not priced here"}`)
  if (mismatches > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

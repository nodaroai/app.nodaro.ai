/**
 * The prices `docs/` quotes, tied to the price ids they come from.
 *
 * The public docs state what a run is CHARGED — the figure on the Run button,
 * `GET /v1/credits/model-cost` and every listing — never a price-table row
 * before the deployment's pricing settings apply. A row-level figure on a page
 * reads like a price and is not one, so every figure carries the id it is
 * priced from, in an HTML comment the rendered page never shows:
 *
 *   33 credits<!-- credits: ugc-finish -->
 *   **36 credits**<!-- credits: elevenlabs-v4:per-100-chars@8 -->
 *   80 credits<!-- credits: 8*camera-switch -->
 *   4.4<!-- credits-rate: elevenlabs-v4:per-100-chars --> credits per started unit
 *
 * The comment binds to the number right before it (a "credits"/"CR" word,
 * a `/unit` suffix and `**` may sit between them). Its expression is one or
 * more charges joined by `+`, each `[<count>*]<price id>[@<units>]`:
 *   - `@units` is ONE charge of that many units of a per-unit rate — the rate's
 *     row × the units, rounded up to a whole credit and priced once, exactly as
 *     a route reserves a per-second or per-minute run (`chargedCredits`);
 *   - `count*` is that many SEPARATE charges (8 clips each charged once);
 *   - `[count*](<part> + <part>)` is ONE charge of several parts — a route
 *     that adds an amount to its row before pricing the total once (Image
 *     Overlay's per-platform renders, Generate Video Pro's fee + segments). A
 *     part is a `<price id>[@<units>]` (its row × units, rounded up) or a
 *     literal amount of the price table's credits; the total is rounded up and
 *     priced at the first id.
 * `credits-rate: <price id>[@<units>]` states exactly (it may be a decimal)
 * what one unit — or that many units — adds to a charge before its total is
 * rounded up: a per-unit rate, or an add-on folded into another price.
 * `credits: n/a` marks a number that is not a price at all (a balance, a grant,
 * a cap the user sets). A figure written as approximate (`~`, `≈`) is not
 * checked and needs no annotation.
 *
 * `backend/src/ee/billing/__tests__/docs-charged-prices.test.ts` evaluates
 * every annotation with the server's own price-table rule
 * (`chargedPriceTableFrom` + `chargedCredits`) at the settings in
 * `docs-price-settings.json`, and fails an unannotated price figure.
 * `npm run docs:prices` checks, rewrites (`--fix`) and live-checks (`--live`)
 * the same annotations.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
export const DOCS_ROOT = join(REPO_ROOT, "docs")
export const DOCS_PRICE_SETTINGS_FILE = join(REPO_ROOT, "backend/src/ee/billing/docs-price-settings.json")

export interface DocsPriceSettings {
  cost_markup_percent: number
  service_margin_percent: Record<string, number>
  /**
   * The charged price of an id this repo cannot price as the deployment does —
   * one priced only by a private plugin, or whose deployed row or settings
   * differ from STATIC_CREDIT_COSTS. A figure, never a rule: it cannot be
   * scaled by units. `docs:prices -- --live` holds it to the deployment, and
   * the docs test fails an entry the repo would price the same without it.
   */
  charged: Record<string, number>
}

/** The pricing settings the docs' figures are charged at (the deployment's). */
export function loadDocsPriceSettings(): DocsPriceSettings {
  const raw = JSON.parse(readFileSync(DOCS_PRICE_SETTINGS_FILE, "utf8")) as Partial<DocsPriceSettings>
  if (typeof raw.cost_markup_percent !== "number") throw new Error(`${DOCS_PRICE_SETTINGS_FILE}: cost_markup_percent must be a number`)
  return {
    cost_markup_percent: raw.cost_markup_percent,
    service_margin_percent: raw.service_margin_percent ?? {},
    charged: raw.charged ?? {},
  }
}

/** The slice of the server's price table the docs price through (`ChargedPriceTable`). */
export interface DocsPriceTable {
  base(identifier: string): number | undefined
  charge(identifier: string, baseCredits: number): number
}

/** One part of a charge: `units` of a price id's row, or a literal amount of the table's credits. */
export interface ChargePart {
  id?: string
  literal?: number
  units: number
}

/** One charge (priced once, at its first id), made `count` times. */
export interface Charge {
  count: number
  parts: ChargePart[]
}

/**
 * The docs' price lookups over the server's price table: one charge priced as
 * `chargedCredits` prices it (its parts' table credits summed, rounded up to a
 * whole credit, charged once at the first id), the exact one-unit amount for a
 * rate, and the `charged` snapshot for the ids the repo cannot price.
 */
export function docsPricing(
  table: DocsPriceTable,
  chargedCredits: (table: DocsPriceTable, identifier: string, units?: number) => number | undefined,
  charged: Record<string, number>,
): { chargeOf: ChargeOf; rateOf: RateOf } {
  return {
    chargeOf: (parts) => {
      const ids = parts.flatMap((p) => (p.id ? [p.id] : []))
      const at = ids[0]
      if (at === undefined) throw new Error("a charge needs a price id to be priced at")
      const snap = ids.find((id) => charged[id] !== undefined)
      if (snap !== undefined) {
        if (parts.length !== 1 || parts[0]!.units !== 1) throw new Error(`"${snap}" is priced from the charged snapshot, which cannot be scaled or added to`)
        return charged[snap]
      }
      if (parts.length === 1) return chargedCredits(table, at, parts[0]!.units)
      let base = 0
      for (const p of parts) {
        if (p.literal !== undefined) {
          base += p.literal
          continue
        }
        const row = table.base(p.id!)
        if (row === undefined) return undefined
        // Each id part is its row × units rounded up, as chargedCredits rounds one.
        base += Math.ceil(row * p.units - 1e-9)
      }
      // The parts' total rounded up, charged once.
      return table.charge(at, Math.ceil(base - 1e-9))
    },
    rateOf: (id) => {
      if (charged[id] !== undefined) throw new Error(`"${id}" is priced from the charged snapshot, which states no exact rate`)
      const row = table.base(id)
      // One unit's exact share of a whole-run charge: the row × 100, charged (a whole number), ÷ 100.
      return row === undefined ? undefined : table.charge(id, row * 100) / 100
    },
  }
}

export type Annotation =
  | { kind: "charge"; charges: Charge[] }
  | { kind: "rate"; id: string; units: number }
  | { kind: "none" }

export interface DocFigure {
  file: string
  line: number
  /** The number the page shows. */
  figure: number
  /** The annotation's text as written. */
  source: string
  annotation: Annotation
}

const ANNOTATION = /<!--\s*credits(-rate)?:\s*(.*?)\s*-->/g
const PART = /^([a-z0-9][a-z0-9.:_-]*?)(?:@(\d+(?:\.\d+)?))?$/i
const LITERAL = /^\d+(?:\.\d+)?$/

/** Splits on `+` outside parentheses. */
function splitTop(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of expr) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "+" && depth === 0) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function parsePart(text: string): ChargePart {
  if (LITERAL.test(text)) return { literal: Number(text), units: 1 }
  const m = text.match(PART)
  if (!m) throw new Error(`cannot read the price part "${text}" (expected id[@units] or an amount)`)
  return { id: m[1]!, units: m[2] ? Number(m[2]) : 1 }
}

/** Parses an annotation's expression; throws on one it cannot read. */
export function parseAnnotation(rate: boolean, expr: string): Annotation {
  if (expr === "n/a") return { kind: "none" }
  if (rate) {
    const m = expr.match(PART)
    if (!m || /\*/.test(expr) || LITERAL.test(expr)) throw new Error(`credits-rate takes one price id[@units], got "${expr}"`)
    return { kind: "rate", id: m[1]!, units: m[2] ? Number(m[2]) : 1 }
  }
  const charges = splitTop(expr).map((item): Charge => {
    const m = item.match(/^(?:(\d+)\s*\*\s*)?(.*)$/s)!
    const count = m[1] ? Number(m[1]) : 1
    const body = m[2]!.trim()
    const group = body.match(/^\((.*)\)$/s)
    const parts = group ? group[1]!.split("+").map((p) => parsePart(p.trim())) : [parsePart(body)]
    if (!parts.some((p) => p.id)) throw new Error(`"${item}" names no price id`)
    if (!group && parts[0]!.literal !== undefined) throw new Error(`a bare amount "${item}" is not a price; put it in a (...) charge`)
    return { count, parts }
  })
  return { kind: "charge", charges }
}

/** The number right before `end` in `line`, past a credits word, a /unit suffix and `**`. */
function figureBefore(line: string, end: number): { value: number; start: number; end: number; text: string } | null {
  const before = line.slice(0, end).replace(/(?:\*\*|\s|-?credits?(?:\/[a-z]+)?|-?\bCR\b)*$/i, "")
  const m = before.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)$/)
  if (!m) return null
  return { value: Number(m[1]!.replace(/,/g, "")), start: before.length - m[1]!.length, end: before.length, text: m[1]! }
}

/** Every annotated figure of one page, in order. Throws on a malformed annotation. */
export function readDocFigures(file: string, text: string): DocFigure[] {
  const out: DocFigure[] = []
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(ANNOTATION)) {
      const where = `${file}:${i + 1}`
      const found = figureBefore(line, m.index!)
      if (found === null) throw new Error(`${where}: "${m[0]}" follows no number`)
      const figure = found.value
      let annotation: Annotation
      try {
        annotation = parseAnnotation(m[1] !== undefined, m[2]!)
      } catch (err) {
        throw new Error(`${where}: ${(err as Error).message}`)
      }
      out.push({ file, line: i + 1, figure, source: m[0], annotation })
    }
  })
  return out
}

/** A number followed by a credits word ("30 credits", "**1 credit**", "12 CR"). */
const PRICE_FIGURE = /(?<![\w.,#§-])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\*\*)?(?:\s|-)?(?:credits?|CR)\b(?:\/[a-z]+)?(?:\*\*)?/gi

export interface UnannotatedFigure {
  file: string
  line: number
  text: string
}

/** Columns whose header names a price: every number in them is one. */
const PRICE_HEADER = /credit|price|\bcost\b/i

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/)
}

/**
 * Price figures on a page that carry no annotation: a non-zero "N credits" in
 * prose, and a non-zero number in a table column headed Credits / Price / Cost.
 * Fenced code is skipped (a sample response is not a price statement).
 */
export function findUnannotatedFigures(file: string, text: string): UnannotatedFigure[] {
  const out: UnannotatedFigure[] = []
  const lines = text.split("\n")
  let fenced = false
  let priceColumns: number[] | null = null
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    // Prose figures — outside inline code (a sample string is not a price statement).
    const prose = line.replace(/`[^`]*`/g, (code) => " ".repeat(code.length))
    for (const m of prose.matchAll(PRICE_FIGURE)) {
      if (Number(m[1]!.replace(/,/g, "")) === 0) continue
      // Written as approximate: not a price statement this check can hold.
      if (/(?:~|≈|\babout|\baround|\broughly)\s*\**$/.test(line.slice(0, m.index!))) continue
      const after = line.slice(m.index! + m[0].length)
      if (/^\s*<!--\s*credits/.test(after)) continue
      // "10 / 20 / 30 credits<!-- … -->" — the last figure of a slash list is annotated with the rest.
      out.push({ file, line: i + 1, text: m[0].trim() })
    }
    // Table figures.
    const isRow = /^\s*\|.*\|\s*$/.test(line)
    if (!isRow) {
      priceColumns = null
      return
    }
    const next = lines[i + 1] ?? ""
    if (priceColumns === null && /^\s*\|?\s*:?-{3,}/.test(next)) {
      priceColumns = cells(line).flatMap((c, k) => (PRICE_HEADER.test(c) ? [k] : []))
      return
    }
    if (/^\s*\|?\s*:?-{3,}/.test(line) || !priceColumns) return
    const row = cells(line)
    for (const k of priceColumns) {
      const cell = row[k] ?? ""
      if (/<!--\s*credits/.test(cell) || /^\s*\**\s*[~≈]/.test(cell)) continue
      const numbers = [...cell.replace(/`[^`]*`/g, "").matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)].map((n) => Number(n[0].replace(/,/g, "")))
      if (numbers.some((n) => n !== 0) && !PRICE_FIGURE.test(cell)) out.push({ file, line: i + 1, text: cell.trim() })
      PRICE_FIGURE.lastIndex = 0
    }
  })
  return out
}

/** Every Markdown page under docs/, as repo-relative paths. */
export function listDocPages(root = DOCS_ROOT): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return e.name.startsWith("_") ? [] : walk(p)
      return /\.(md|txt)$/.test(e.name) ? [relative(REPO_ROOT, p)] : []
    })
  return walk(root).sort()
}

/** The price of one charge, or undefined when one of its ids is priced nowhere. */
export type ChargeOf = (parts: ChargePart[]) => number | undefined
/** The exact credits one unit of `id` adds to a whole-run charge, or undefined when it is priced nowhere. */
export type RateOf = (id: string) => number | undefined

/** The price an annotation states, or undefined when one of its ids is priced nowhere (or it is `n/a`). */
export function priceOf(annotation: Annotation, chargeOf: ChargeOf, rateOf: RateOf): number | undefined {
  if (annotation.kind === "none") return undefined
  if (annotation.kind === "rate") {
    const one = rateOf(annotation.id)
    return one === undefined ? undefined : Math.round(one * annotation.units * 1e6) / 1e6
  }
  let total = 0
  for (const charge of annotation.charges) {
    const one = chargeOf(charge.parts)
    if (one === undefined) return undefined
    total += charge.count * one
  }
  return total
}

/** The ids an annotation is priced from. */
export function annotationIds(annotation: Annotation): string[] {
  if (annotation.kind === "none") return []
  if (annotation.kind === "rate") return [annotation.id]
  return annotation.charges.flatMap((c) => c.parts.flatMap((p) => (p.id ? [p.id] : [])))
}

function formatFigure(value: number, was: string): string {
  const exact = Math.round(value * 1e6) / 1e6
  // The page's own style: a figure written with a thousands separator keeps one.
  const grouped = was.includes(",")
  return grouped ? exact.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(exact)
}

/**
 * The page with every annotated figure set to `valueOf(annotation)` (left as
 * it is where that is undefined). What `scripts/docs-prices.ts --fix` writes.
 */
export function rewriteDocFigures(text: string, valueOf: (annotation: Annotation) => number | undefined): string {
  return text
    .split("\n")
    .map((line) => {
      let out = line
      // Right to left, so an edit never moves a figure still to be read.
      const found = [...line.matchAll(ANNOTATION)].reverse()
      for (const m of found) {
        const figure = figureBefore(out, m.index!)
        if (!figure) continue
        const value = valueOf(parseAnnotation(m[1] !== undefined, m[2]!))
        if (value === undefined || value === figure.value) continue
        out = out.slice(0, figure.start) + formatFigure(value, figure.text) + out.slice(figure.end)
      }
      return out
    })
    .join("\n")
}

/**
 * THE ONE FUNNEL every document the MCP lane serves goes through (decided
 * 2026-11-15): the node skills (`get_node_skill`), the recipes and their files
 * (`get_recipe`), the workflow editor, the video and film directors, and the
 * Studio and Recast guides a plugin answers.
 *
 * Those documents are written in the platform's credits: a generated
 * `**Credit cost:**` line per node skill, figures annotated with the price id
 * they come from (`55 credits<!-- credits: render-video -->`, syntax in
 * `scripts/lib/docs-prices.ts`), and a few written as approximate (`~495cr`).
 * An MCP client is a language model and repeats the figures it reads, so on a
 * deployment in its own terms (`ownTermsActive()`: a unit of its own, an
 * external wallet, or no self-serve billing) a served document states no raw
 * credit figure:
 *
 *  - the generated `**Credit cost:**` line becomes a figure-free pointer to
 *    where the deployment's own price is stated (`list_models` and the
 *    description of the tool that runs the node);
 *  - a figure that names credits — annotated, or written next to the word
 *    (`~495cr`, `12 credits`) — is converted into the deployment's unit when
 *    the unit holds it exactly (every whole number of credits does; a rate
 *    such as 1.1 may not), with the unit's word; otherwise it becomes a
 *    pointer to `list_models`. An approximate figure stays approximate (`~`);
 *  - a figure that multiplies a count (`10 × (sources − 1) credits`) carries no
 *    price id at all and is never converted: it becomes the pointer;
 *  - the annotations themselves are dropped (they would label a converted
 *    figure as credits).
 *
 * Nothing else in the text moves for the unit. On a deployment with its own
 * name, the document then says that name instead of the platform's
 * (`deployment-name.ts`: products, hosts and ids by the same rules as every
 * other reply of the lane). On a deployment that restricts what it offers, a
 * document that names a tool the session is not listed or a model the
 * deployment withholds opens with a generated note saying so (`offer-note.ts`,
 * decided 2026-11-16); its prose is never rewritten. WITH NOTHING CONFIGURED
 * the text is returned as it came (the same string), so every document is
 * served byte for byte as before (`__tests__/deployment-documents.test.ts`).
 *
 * Core code, loaded on every edition: plain text in, text out, through the
 * same conversion every other amount the lane states uses (`amounts.ts`). The
 * rate is never stated.
 */
import { toUnits, type DisplayUnit } from "../billing-display-unit.js"
import { PRICE_ANNOTATION, figureBefore } from "../price-annotations.js"
import { amountTerms, ownTermsActive, unitEnglishWord, type AmountTerms } from "./amounts.js"
import { statedName } from "./deployment-name.js"
import { withOfferNote } from "./offer-note.js"
import type { McpSession } from "./session.js"

/** A credits word as a document writes it after a figure: `credits`, `credit`, `cr`, `CR`. */
const CREDIT_WORD = String.raw`(?:credits?|cr)\b`

/**
 * A figure written next to a credits word, approximate or not: `12 credits`,
 * `**1 credit**`, `~495cr`, `≈ 2970cr/min`. The same shape the docs price check
 * reads as a price (`PRICE_FIGURE` in `scripts/lib/docs-prices.ts`), with the
 * approximate mark kept so it can stay.
 */
const WORDED_FIGURE = new RegExp(
  String.raw`(?<![\w.,#§-])([~≈]\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\*\*)?((?:\s|-)?)(${CREDIT_WORD})(\/[a-z]+)?(\*\*)?`,
  "gi",
)

/** A count multiplied by a credit figure: `10 × (sources − 1) credits`. */
const FORMULA_FIGURE = new RegExp(String.raw`(?<![\w.,#§-])(\d+(?:\.\d+)?)\s*[×x]\s*(\([^)\n]*\))\s*(${CREDIT_WORD})`, "gi")

/** The generated (or, for a legacy node, hand-written) price line of a node skill. */
const COST_LINE = /^\*\*Credit cost:\*\*.*$/

/** One edit to a line, from its original text. */
interface Edit {
  start: number
  end: number
  text: string
}

/** The deployment's terms as a document states them. */
interface DocumentTerms {
  unit: DisplayUnit | null
  word: string
}

/**
 * Where a figure that can not be stated exactly is stated instead: the price
 * id's own quote when the annotation names exactly one, else `list_models`.
 */
function pointer(word: string, priceId?: string): string {
  return priceId ? `the figure \`list_models\` quotes in ${word} for \`${priceId}\`` : `an amount \`list_models\` states in ${word}`
}

/** The one price id an annotation's expression names, when it is a bare id (no count, units or sum). */
function bareId(expression: string): string | undefined {
  return /^[a-z0-9][a-z0-9.:_-]*$/i.test(expression) && expression !== "n/a" ? expression : undefined
}

/**
 * `credits` as a figure in the unit, or null when the unit cannot hold it
 * exactly. Without a unit the figure is the deployment's own: `written`, as
 * the document wrote it.
 */
function exactlyStated(credits: number, unit: DisplayUnit | null, written: string): string | null {
  if (unit === null) return written
  const shown = toUnits(credits, unit.rate, unit.decimals)
  if (shown === null) return null
  const f = 10 ** unit.decimals
  // Exact when the unit's decimals hold the product: no rounding happened.
  return Math.abs(shown * f - credits * unit.rate * f) < 1e-6 ? formatted(shown) : null
}

function formatted(n: number): string {
  return String(Math.round(n * 1e6) / 1e6)
}

/** The figure-free pointer a node skill's price line becomes. */
function costPointer(line: string, word: string): string {
  if (/^\*\*Credit cost:\*\* none declared/.test(line)) {
    return `**Credit cost:** none declared — an input / parameter / trigger node runs no job; otherwise \`list_models\` (\`priceIds\`) states the price of a run in ${word}.`
  }
  const llmKey = /`priceIds: \["([^"\n]+)"\]`/.exec(line)?.[1]
  if (llmKey) {
    return `**Credit cost:** on this deployment, \`list_models\` with \`priceIds: ["${llmKey}"]\` quotes a call in ${word} (an LLM call is charged per token at its model's rate); this line names no figure.`
  }
  return `**Credit cost:** on this deployment, \`list_models\` (\`priceIds\`) and the description of the tool that runs this node state the price in ${word}; this line names no figure.`
}

/** The edits for every annotated figure of a line: converted (or the pointer), the annotation dropped. */
function annotationEdits(line: string, terms: DocumentTerms): Edit[] {
  const edits: Edit[] = []
  for (const m of line.matchAll(PRICE_ANNOTATION)) {
    const at = m.index!
    const end = at + m[0].length
    const figure = figureBefore(line, at)
    if (figure === null) {
      edits.push({ start: at, end, text: "" })
      continue
    }
    // The credits word: before the comment (`11 credits**<!--`) or right after it (`--> credits`, `-->cr/block`).
    const between = line.slice(figure.end, at)
    const after = new RegExp(String.raw`^(\s?)(${CREDIT_WORD})`, "i").exec(line.slice(end))
    const stated = exactlyStated(figure.value, terms.unit, figure.text)
    if (stated === null) {
      // The figure, its word and its comment become the pointer; a word after the comment goes too.
      const stop = end + (after ? after[0].length : 0)
      const lead = between.replace(new RegExp(String.raw`-?${CREDIT_WORD}`, "i"), "").replace(/\s+/g, "")
      edits.push({ start: figure.start, end: stop, text: `${pointer(terms.word, bareId(m[2]!))}${lead}` })
      continue
    }
    const word = between.match(new RegExp(String.raw`-?${CREDIT_WORD}`, "i"))
    const newBetween = word ? between.replace(word[0], `${word[0].startsWith("-") ? "-" : ""}${terms.word}`) : between
    edits.push({ start: figure.start, end: figure.end, text: stated })
    if (newBetween !== between) edits.push({ start: figure.end, end: at, text: newBetween })
    edits.push({ start: at, end: end + (after ? after[0].length : 0), text: after ? ` ${terms.word}` : "" })
  }
  return edits
}

/** The edits for every figure written next to a credits word that carries no annotation. */
function wordedEdits(line: string, terms: DocumentTerms, taken: readonly Edit[]): Edit[] {
  const edits: Edit[] = []
  const overlaps = (s: number, e: number) => taken.some((t) => s < t.end && t.start < e) || edits.some((t) => s < t.end && t.start < e)
  for (const m of line.matchAll(FORMULA_FIGURE)) {
    const start = m.index!
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    edits.push({ start, end, text: `${m[2]} × ${pointer(terms.word)}` })
  }
  for (const m of line.matchAll(WORDED_FIGURE)) {
    const start = m.index!
    const end = start + m[0].length
    if (overlaps(start, end)) continue
    // An annotated one (`12 credits<!-- credits: x -->`) is the annotation's to state.
    if (/^\s*<!--\s*credits/.test(line.slice(end))) continue
    const [, approx = "", digits, bold1 = "", , , suffix = "", bold2 = ""] = m
    const stated = exactlyStated(Number(digits!.replace(/,/g, "")), terms.unit, digits!)
    edits.push({
      start,
      end,
      text: stated === null ? pointer(terms.word) : `${approx}${stated}${bold1} ${terms.word}${suffix}${bold2}`,
    })
  }
  return edits
}

function applied(line: string, edits: Edit[]): string {
  let out = line
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** One line of a document, as a deployment in its own terms is served it. */
function statedLine(line: string, terms: DocumentTerms): string {
  if (COST_LINE.test(line)) return costPointer(line, terms.word)
  const annotated = annotationEdits(line, terms)
  return applied(line, [...annotated, ...wordedEdits(line, terms, annotated)])
}

/** A column whose header names a price: every number in it is one (the docs price check's rule). */
const PRICE_HEADER = /credit|price|\bcost\b/i
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}/
const CELL_SPLIT = /(?<!\\)\|/

/** A price column's cell: each bare number in it (outside inline code) stated, or the pointer. */
function statedPriceCell(cell: string, terms: DocumentTerms): string {
  // An annotated or worded figure is the line rules' to state.
  if (/<!--\s*credits/.test(cell) || new RegExp(WORDED_FIGURE.source, "i").test(cell)) return statedLine(cell, terms)
  return cell.replace(/`[^`]*`|(?<![\w.])\d[\d,]*(?:\.\d+)?/g, (token) => {
    if (token.startsWith("`")) return token
    return exactlyStated(Number(token.replace(/,/g, "")), terms.unit, token) ?? pointer(terms.word)
  })
}

/** A table's header cell over a price column: its credits word becomes the unit's. */
function statedHeaderCell(cell: string, terms: DocumentTerms): string {
  return cell.replace(new RegExp(String.raw`\b${CREDIT_WORD}`, "i"), (w) => (w[0] === w[0]!.toUpperCase() ? terms.word.charAt(0).toUpperCase() + terms.word.slice(1) : terms.word))
}

/**
 * A served document as this deployment states it to `session`: the text
 * itself with nothing configured, and on a deployment in its own terms the
 * same text with no raw credit figure in it (see the header). A table column
 * headed Credits, Price or Cost is read as figures throughout, as the docs
 * price check reads it.
 *
 * On a deployment that restricts what it offers (`session.offer`), a document
 * that names tools this session is not listed or models the deployment
 * withholds opens with a generated note saying which (`offer-note.ts`): read
 * from the text as it came, then stated with it.
 */
export function statedDocument(text: string, session: Pick<McpSession, "offer">, t: AmountTerms = amountTerms()): string {
  const noted = session.offer ? withOfferNote(text, session.offer) : text
  // The deployment's own name, after its own terms (deployment-name.ts): with
  // the platform's name the text is returned as it came.
  return statedName(ownTermsActive(t) ? inOwnTerms(noted, t) : noted)
}

/** A served document's figures in the deployment's own terms (see the header). */
function inOwnTerms(text: string, t: AmountTerms): string {
  const terms: DocumentTerms = { unit: t.unit, word: t.unit ? unitEnglishWord(t.unit) : "credits" }
  const lines = text.split("\n")
  let priceColumns: number[] | null = null
  return lines
    .map((line, i) => {
      if (!TABLE_ROW.test(line)) {
        priceColumns = null
        return statedLine(line, terms)
      }
      const cells = line.split(CELL_SPLIT)
      // Cell 0 is what sits before the first `|`; the header's columns are counted from cell 1.
      if (priceColumns === null && TABLE_RULE.test(lines[i + 1] ?? "")) {
        priceColumns = cells.flatMap((c, k) => (k > 0 && PRICE_HEADER.test(c) ? [k] : []))
        return cells.map((c, k) => (priceColumns!.includes(k) ? statedHeaderCell(c, terms) : statedLine(c, terms))).join("|")
      }
      if (TABLE_RULE.test(line) || priceColumns === null) return statedLine(line, terms)
      const columns: readonly number[] = priceColumns
      return cells.map((c, k) => (columns.includes(k) ? statedPriceCell(c, terms) : statedLine(c, terms))).join("|")
    })
    .join("\n")
}

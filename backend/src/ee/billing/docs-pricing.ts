// @reads backend/src/ee/billing/docs-price-settings.json
/**
 * THE CHARGED PRICE, FOR TEXT THAT CANNOT ASK THE DATABASE.
 *
 * Every price a reader is told — a figure in `docs/`, a credit hint in an MCP
 * tool description, the `**Credit cost:**` line of a generated node skill,
 * the model tables of `docs/choosing-models.md` — is the price a run is
 * CHARGED: the figure on the Run button and `/v1/credits/model-cost`, never a
 * price-table row before the deployment's pricing settings apply.
 *
 * Text is written before any request is served, so it cannot read the live
 * table. It prices instead with the server's own price-table rule
 * (`chargedPriceTableFrom` + `chargedCredits`) over `STATIC_CREDIT_COSTS` —
 * which `__tests__/static-costs-match-migrations.test.ts` holds to the
 * migrations — at the hosted deployment's settings in
 * `docs-price-settings.json`. That file also carries a `charged` snapshot for
 * the ids this repo cannot price as the deployment does (one priced only by
 * a private plugin, or one whose row an admin repriced at runtime);
 * `npm run docs:prices -- --live <url> --write` refreshes it from a running
 * deployment. One rule, one settings file, for every surface: the docs test
 * (`__tests__/docs-charged-prices.test.ts`), `gen:skills` and the MCP hints
 * (`lib/mcp/tools/_credit-hint.ts`) all read it from here, through
 * `statedPrices()` (`stated-prices.ts`).
 *
 * The settings file ships next to the compiled module
 * (`scripts/copy-build-assets.mjs`), so the hints read it in the image too.
 * This module stays free of the billing module (a script sets its env before
 * loading that); `stated-prices.ts` joins the two.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const DOCS_PRICE_SETTINGS_FILE = fileURLToPath(new URL("./docs-price-settings.json", import.meta.url))

export interface DocsPriceSettings {
  cost_markup_percent: number
  service_margin_percent: Record<string, number>
  /**
   * The charged price of an id this repo cannot price as the deployment does —
   * one priced only by a private plugin, or whose deployed row or settings
   * differ from STATIC_CREDIT_COSTS. A figure, never a rule: it cannot be
   * scaled by units. `docs:prices -- --live <url> --write` refreshes it from
   * the deployment, and the docs test fails an entry the repo would price
   * the same without it.
   */
  charged: Record<string, number>
}

/** The pricing settings the charged figures are stated at (the hosted deployment's). */
export function loadDocsPriceSettings(file = DOCS_PRICE_SETTINGS_FILE): DocsPriceSettings {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<DocsPriceSettings>
  if (typeof raw.cost_markup_percent !== "number") throw new Error(`${file}: cost_markup_percent must be a number`)
  return {
    cost_markup_percent: raw.cost_markup_percent,
    service_margin_percent: raw.service_margin_percent ?? {},
    charged: raw.charged ?? {},
  }
}

/** The slice of the server's price table the charged figures are priced through (`ChargedPriceTable`). */
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

/** The price of one charge, or undefined when one of its ids is priced nowhere. */
export type ChargeOf = (parts: ChargePart[]) => number | undefined
/** The exact credits one unit of `id` adds to a whole-run charge, or undefined when it is priced nowhere. */
export type RateOf = (id: string) => number | undefined

/**
 * Price lookups over the server's price table: one charge priced as
 * `chargedCredits` prices it (its parts' table credits summed, rounded up to a
 * whole credit, charged once at the first id), the exact one-unit amount for a
 * rate, and the `charged` snapshot for the ids the repo cannot price.
 */
export function docsPricing(
  table: DocsPriceTable,
  chargedCreditsOf: (table: DocsPriceTable, identifier: string, units?: number) => number | undefined,
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
      if (parts.length === 1) return chargedCreditsOf(table, at, parts[0]!.units)
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

// ── Metered LLM figures ─────────────────────────────────────────────────────

/** A lane a metered LLM call is served — and charged — on: the aggregator, or the model's provider's own API. */
export type DocsLlmLane = "kie" | "direct"

/**
 * A metered LLM figure a page states (`credits-llm-rate:`):
 *   - `per-million` — the credits charged per million input or output tokens on
 *     one lane's own rate card (`band: "long"` = the second band a model steps
 *     up to past its prompt threshold);
 *   - `call` — what ONE call of that usage on that lane is charged, the way a
 *     metered settle charges it.
 */
export type DocsLlmFigure =
  | { kind: "per-million"; modelId: string; lane: DocsLlmLane; direction: "input" | "output"; band: "base" | "long" }
  | { kind: "call"; modelId: string; lane: DocsLlmLane; inputTokens: number; outputTokens: number }

/** The credits a {@link DocsLlmFigure} states, or undefined when the model has no rate of its own on that lane. */
export type LlmFigureOf = (figure: DocsLlmFigure) => number | undefined

/** One lane's own rate card, USD per million tokens (`llmRateCard` in `lib/pricing/llm-cost.ts`). */
export interface DocsLlmRateCard {
  inputPerM: number
  outputPerM: number
  longContext?: { thresholdTokens: number; inputPerM: number; outputPerM: number }
}

/**
 * What a metered LLM figure is priced from — the server's own functions,
 * injected so this module stays free of the billing module.
 */
export interface DocsLlmRateSource {
  /** The lane's OWN rate card (never the KIE row a missing direct row falls back to). */
  rateCard(modelId: string, lane: DocsLlmLane): DocsLlmRateCard | undefined
  /** A call's provider cost on the lane (`calculateLlmCost`). */
  callCostUsd(modelId: string, lane: DocsLlmLane, usage: { inputTokens: number; outputTokens: number }): number
  /** `usdToCredits`. */
  usdToCredits(usd: number): number
  /** `applyMarkupPercent` — the platform's one markup-rounding formula. */
  markUp(baseCredits: number, percent: number): number
  /** The smallest cost a call that reached the vendor is charged (`CREDIT_BASE_USD`). */
  minimumUsd: number
}

/**
 * Metered LLM figures at `markupPercent` (the deployment's global setting —
 * every metered feature is charged at it unless the admin gives the feature a
 * margin of its own):
 *   - per million tokens: the rate × 1M, in whole credits, charged — what a
 *     million tokens alone would be charged;
 *   - a call: its cost summed, floored at the minimum, then charged ONCE —
 *     exactly the settle's `computeActualCredits(max(cost, CREDIT_BASE_USD))`.
 */
export function docsLlmPricing(source: DocsLlmRateSource, markupPercent: number): LlmFigureOf {
  return (figure) => {
    const card = source.rateCard(figure.modelId, figure.lane)
    if (!card) return undefined
    if (figure.kind === "per-million") {
      const band = figure.band === "long" ? card.longContext : card
      if (!band) return undefined
      const usd = figure.direction === "input" ? band.inputPerM : band.outputPerM
      return source.markUp(source.usdToCredits(usd), markupPercent)
    }
    const usd = source.callCostUsd(figure.modelId, figure.lane, { inputTokens: figure.inputTokens, outputTokens: figure.outputTokens })
    return source.markUp(source.usdToCredits(Math.max(usd, source.minimumUsd)), markupPercent)
  }
}

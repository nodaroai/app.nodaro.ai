/**
 * `estimate_only` on a run verb: the price of the run it would start, asked of
 * `POST /v1/quote` with the node type and the SAME body the verb would post to
 * its run route. The quote runs that route's own pre-checks and pricing and
 * creates nothing, so a refusal here is the one the run would give first, and
 * comes back as a tool error carrying the route's code and sentence.
 *
 * The answer states the hold (`reserve`) through the amounts funnel
 * (lib/mcp/amounts.ts). Whether the hold is the MOST the run can cost is read
 * from the quote's own `settles_to_actual` warning, never from the tool's
 * name, so a node that starts settling to what it used says so with no edit
 * here.
 *
 * Reached through `mcpInject`, never `dispatchJob`: a quote is no node of the
 * conversation's flow and starts no job. On an edition without credits there
 * is no quote route and nothing to price; the answer says that.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { hasCredits } from "../../config.js"
import { amountPhrase, statedAmountFields, unitFields } from "../amounts.js"
import { mcpInject } from "../internal-request.js"
import type { McpSession } from "../session.js"
import { errorResult } from "./_verb-helpers.js"

/** The quote's warning that says its hold is the most the run can cost. */
const SETTLES_TO_ACTUAL = "settles_to_actual"

/** The `estimate_only` argument of a run verb. */
export const estimateOnlySchema = z.boolean().optional().describe("Price only: nothing is created or charged.")

/** A run verb's structured answer to `estimate_only` (it has no job). */
export const estimateOutputSchema = z.record(z.string(), z.unknown()).optional().describe("estimate_only: the price. Nothing ran.")

interface QuoteNote {
  readonly code: string
  readonly message: string
  readonly credits?: number
}

interface NodeQuote {
  readonly reserve: number
  readonly expected?: number
  readonly adjustments: readonly QuoteNote[]
  readonly warnings: readonly QuoteNote[]
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

function notesOf(value: unknown): QuoteNote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): QuoteNote[] => {
    if (!row || typeof row !== "object") return []
    const { code, message, credits } = row as Record<string, unknown>
    if (typeof code !== "string" || typeof message !== "string") return []
    return [{ code, message, ...(finite(credits) ? { credits } : {}) }]
  })
}

function quoteOf(body: string): NodeQuote | null {
  try {
    const data = (JSON.parse(body) as { data?: Record<string, unknown> }).data
    if (!data || !finite(data.reserve)) return null
    return {
      reserve: data.reserve,
      ...(finite(data.expected) ? { expected: data.expected } : {}),
      adjustments: notesOf(data.adjustments),
      warnings: notesOf(data.warnings),
    }
  } catch {
    return null
  }
}

function quoteSentence(label: string, tool: string, q: NodeQuote): string {
  const most = q.warnings.some((w) => w.code === SETTLES_TO_ACTUAL)
  const expected = q.expected !== undefined && q.expected !== q.reserve ? `; expected to cost ${amountPhrase(q.expected)}` : ""
  return [
    `${label} would reserve ${amountPhrase(q.reserve)}${most ? ", the most this run can cost" : ""}${expected}.`,
    ...[...q.adjustments, ...q.warnings].map((n) => n.message),
    `Nothing was created or charged; call ${tool} without estimate_only to run it.`,
  ].join(" ")
}

/**
 * The answer to `estimate_only`: the price of running node `type` on `params`
 * (the body the verb would post to its run route), or the quote's refusal.
 */
export async function nodeQuoteResult(
  fastify: FastifyInstance,
  session: McpSession,
  opts: { readonly tool: string; readonly label: string; readonly type: string; readonly params: Record<string, unknown> },
) {
  if (!hasCredits()) {
    return {
      content: [{ type: "text" as const, text: `${opts.label}: not billed in credits on this edition. Nothing was created or charged.` }],
      structuredContent: { estimate: { billed: false } },
    }
  }
  const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/quote", payload: { type: opts.type, params: opts.params } })
  if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
  const quote = quoteOf(res.body)
  if (!quote) {
    return { content: [{ type: "text" as const, text: `${opts.tool}: the quote could not be read.` }], isError: true as const }
  }
  const figures = statedAmountFields(
    { reserveCredits: quote.reserve, ...(quote.expected !== undefined ? { expectedCredits: quote.expected } : {}) },
    ["reserveCredits", "expectedCredits"],
  )
  return {
    content: [{ type: "text" as const, text: quoteSentence(opts.label, opts.tool, quote) }],
    structuredContent: {
      estimate: {
        ...figures,
        mostItCanCost: quote.warnings.some((w) => w.code === SETTLES_TO_ACTUAL),
        adjustments: quote.adjustments.map((a) => statedAmountFields(a, ["credits"])),
        warnings: quote.warnings,
        // The figures' unit, where the deployment has its own (lib/mcp/amounts.ts).
        ...unitFields(),
      },
    },
  }
}

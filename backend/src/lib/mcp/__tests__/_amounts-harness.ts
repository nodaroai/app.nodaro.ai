/**
 * The fixtures every deployment-amounts test reads its replies through: one
 * full MCP server (every scope, Cloud), the reads it makes answered from fixed
 * rows with DISTINCTIVE raw figures (none of which a converted figure, an id or
 * a timestamp can contain), and the routes its tools call answered by stubs.
 *
 * The figures are raw credits. Every one is listed in `RAW_FIGURES`, so a test
 * can prove that a reply on a deployment with its own unit carries none of them.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { usecaseEstimatePath, type UseCaseNodeType } from "@nodaro/render-rules"
import type { Scope } from "../../scopes.js"
import { ALL_SCOPES } from "../../scopes.js"

export const JOB_ID = "a0000000-0000-4000-8000-00000000000a"
export const PUBLIC_JOB_ID = "b0000000-0000-4000-8000-00000000000b"
export const USER_ID = "c0000000-0000-4000-8000-00000000000c"
export const WORKFLOW_ID = "d0000000-0000-4000-8000-00000000000d"
export const EXECUTION_ID = "e0000000-0000-4000-8000-00000000000e"

export const BALANCE = {
  total: 7919,
  subscription: 6007,
  topup: 1912,
  dailySpent: 313,
  dailyLimit: 4421,
  monthlyAllocation: 6007,
  tier: "pro",
  effectiveTier: "pro",
  features: { competitor_history_months: 6 },
  periodEnd: "2026-12-01T00:00:00Z",
  appCreditsAllowance: 37,
}

export const WALLET_AVAILABLE = 2741
export const ALLOWANCE = { granted: 5003, remaining: 3301, spent: 1702 }

export const JOB_ROW = {
  id: JOB_ID,
  status: "completed",
  progress: 100,
  input_data: { type: "tighten-episode", prompt: "a cat", _feeCredits: 211 },
  output_data: { videoUrl: "https://cdn.example/v.mp4", analysisCredits: 157 },
  error_message: null,
  error_detail: null,
  error_hint: null,
  created_at: "2026-11-01T00:00:00Z",
  started_at: "2026-11-01T00:00:01Z",
  completed_at: "2026-11-01T00:00:02Z",
  job_type: "tighten-episode",
  credits: 6113,
  user_id: USER_ID,
  usage_log_id: "f0000000-0000-4000-8000-00000000000f",
  workflow_execution_id: null,
}
/** What the run loader answers for the job (charged, held, released). */
export const JOB_CHARGE = { credits_charged: 4993, credits_held: 6113, credits_released: 1120 }

export const PUBLIC_JOB_ROW = {
  id: PUBLIC_JOB_ID,
  status: "completed",
  progress: 100,
  input_data: { type: "generate-image", prompt: "a dog" },
  output_data: { imageUrl: "https://cdn.example/i.png" },
  error_message: null,
  error_detail: null,
  created_at: "2026-11-02T00:00:00Z",
  completed_at: "2026-11-02T00:00:02Z",
  job_type: "generate-image",
  credits: 8231,
  user_id: "99999999-0000-4000-8000-000000000099",
}

export const PURCHASE_ROW = {
  id: "tx-a",
  stripe_transaction_id: "pi_a",
  type: "topup",
  amount_usd: 24,
  credits_granted: 5821,
  tier: "pro",
  created_at: "2026-10-01T00:00:00Z",
  receipt_url: null,
}
export const USAGE_ROW = {
  id: "use-a",
  created_at: "2026-11-01T00:00:00Z",
  credits_used: 6113,
  credits_charged: 4993,
  action: "tighten-episode",
  provider: "nodaro",
  status: "committed",
  metadata: { model: "tighten-episode", from_sub: 4111, from_topup: 882, allowance_delta: 4993 },
  workspace_id: null,
}

/** The price a priced id answers in `list_models` `priceIds`. */
export const PRICED_ID = "kling-turbo:5s"
export const PRICED_CREDITS = 9067

export const USE_CASE_QUOTE = { totalCredits: 8467, stepsCredits: 8353, feeCredits: 114, durationSec: 3600 }
export const RENDER_FINAL_QUOTE = {
  renderNodeId: "render-1",
  nodeIds: ["render-1", "cam-1"],
  inputOverrides: { "render-1": { quality: "final" } },
  estimatedCredits: 7433,
  estimatedCreditsIsEstimate: false,
  holdCredits: 7877,
  sufficient: false,
  available: 3389,
}

/** Every raw figure above: none may appear in a reply on a deployment with its own unit. */
export const RAW_FIGURES = [
  BALANCE.total, BALANCE.subscription, BALANCE.topup, BALANCE.dailySpent, BALANCE.dailyLimit, BALANCE.appCreditsAllowance,
  WALLET_AVAILABLE, ALLOWANCE.granted, ALLOWANCE.remaining,
  JOB_ROW.credits, JOB_ROW.input_data._feeCredits, JOB_ROW.output_data.analysisCredits,
  JOB_CHARGE.credits_charged, JOB_CHARGE.credits_released,
  PUBLIC_JOB_ROW.credits, PURCHASE_ROW.credits_granted,
  USAGE_ROW.metadata.from_sub, USAGE_ROW.metadata.from_topup,
  PRICED_CREDITS,
  USE_CASE_QUOTE.totalCredits, USE_CASE_QUOTE.stepsCredits, USE_CASE_QUOTE.feeCredits,
  RENDER_FINAL_QUOTE.estimatedCredits, RENDER_FINAL_QUOTE.holdCredits, RENDER_FINAL_QUOTE.available,
] as const

/** The raw figures a serialized reply names, as whole numbers (a converted figure never contains one). */
export function rawFiguresIn(text: string): number[] {
  return RAW_FIGURES.filter((n) => new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(text))
}

/** Per-table rows the fake database answers with. */
export type TableRows = Record<string, unknown[]>

/**
 * A fluent fake of the database client: every builder method returns the
 * chain, awaiting it answers the table's rows, `maybeSingle()` / `single()`
 * the first. A table with no rows answers none.
 */
export function fakeSupabaseFrom(tables: () => TableRows) {
  return (table: string) => {
    const rows = () => tables()[table] ?? []
    const chain: Record<string, unknown> = {}
    const answer = () => ({ data: rows(), error: null })
    for (const m of ["select", "eq", "neq", "is", "in", "not", "or", "order", "limit", "lt", "lte", "gt", "gte", "filter", "range", "contains", "match", "update", "insert", "upsert", "delete"]) {
      chain[m] = () => chain
    }
    chain.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    chain.single = async () => ({ data: rows()[0] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject)
    return chain
  }
}

export const DEFAULT_TABLES: TableRows = {
  jobs: [JOB_ROW],
  transactions: [PURCHASE_ROW],
  usage_logs: [USAGE_ROW],
}

/** The routes the tools under test call, answered with the fixed quotes above. */
export async function stubRoutes(
  opts: { useCaseRefusal?: { status: number; message: string; required?: number; balance?: number } } = {},
): Promise<FastifyInstance> {
  const fastify = Fastify()
  const type: UseCaseNodeType = "tighten-episode"
  fastify.post(usecaseEstimatePath(type), async () => ({ data: USE_CASE_QUOTE }))
  fastify.post("/v1/tighten-episode", async (_req, reply) => {
    const refusal = opts.useCaseRefusal
    if (refusal) {
      // The route's body: its message, and the RAW figures it states beside the error (lib/use-case/credits-refusal.ts).
      const { status, message, ...figures } = refusal
      return reply.code(status).send({ error: { code: "insufficient_credits", message }, ...figures })
    }
    return reply.code(202).send({ jobId: JOB_ID, executionId: EXECUTION_ID })
  })
  fastify.post(`/v1/workflows/${WORKFLOW_ID}/render-final/estimate`, async () => ({ data: RENDER_FINAL_QUOTE }))
  await fastify.ready()
  return fastify
}

/** Every scope a session can hold. */
export const EVERY_SCOPE: Scope[] = [...ALL_SCOPES]

/** One serialized reply: its text, and its structuredContent when it has one. */
export function serialized(res: { content?: unknown; structuredContent?: unknown; isError?: unknown }): string {
  return JSON.stringify({ content: res.content, structuredContent: res.structuredContent ?? null, isError: res.isError ?? null })
}

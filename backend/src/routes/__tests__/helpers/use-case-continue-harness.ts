/**
 * The shared harness of the /v1/tighten-episode/continue tests: fixtures, an
 * in-memory `jobs` table, and the module mocks. Imported FIRST by each test
 * file, so its mocks are registered before anything they replace loads; the
 * route itself is loaded on first use, once the state the mocks read exists.
 */
import { expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph } from "@nodaro/render-rules"

export const USER = "00000000-0000-4000-8000-000000000001"
export const ID = "00000000-0000-4000-8000-0000000000aa"
export const settings = { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }
export const graph = toStoredInlineGraph(
  buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } }),
  settings,
)

export const failedWrapper = {
  id: ID, user_id: USER, status: "failed", provider: "use-case",
  input_data: { type: "tighten-episode", mode: "run", _executionId: "exec-0", _feeCredits: 10, settings: {}, mediaUrl: "https://r2/ep.mp4", durationSec: 3600 },
}
export const completedPreviewWrapper = { ...failedWrapper, status: "completed" }
export const failedSource = {
  id: "exec-0", userId: USER, workflowId: null, status: "failed", appVersionId: null, inlineGraphHash: graph.hash,
  nodeStates: {
    "uc-source": { status: "completed" }, "uc-transcribe": { status: "completed" }, "uc-silence": { status: "completed" },
    "uc-plan": { status: "completed" }, "uc-render": { status: "failed" }, "uc-captions": { status: "skipped" },
  },
}
export const previewSource = {
  ...failedSource, status: "completed",
  nodeStates: {
    ...failedSource.nodeStates,
    "uc-render": { status: "completed", output: { videoUrl: "https://r2/p.mp4", quality: "proxy" } },
    "uc-captions": { status: "skipped" },
  },
}
/** A Render final that failed at its captions: the render at Final completed. */
export const failedFinalSource = {
  ...failedSource,
  nodeStates: { ...failedSource.nodeStates, "uc-render": { status: "completed", output: { videoUrl: "x", quality: "final" } }, "uc-captions": { status: "failed" } },
}

export const src = {
  wrapper: null as Record<string, unknown> | null,
  wrapperError: null as { message: string } | null,
  graph: null as unknown,
  source: null as Record<string, unknown> | null,
  finalCredits: { estimatedCredits: 600, sufficient: true, available: 5000 } as Record<string, unknown> | null,
  finalCreditsArgs: [] as unknown[],
  foundExec: null as string | null,
  graphReads: [] as string[],
  /** A final-chain wrapper of the source run already there (any status; the query filters). */
  existingFinal: null as { id: string; status: string; finalEdit?: string } | null,
  finalQueries: [] as Array<{ eqs: Array<[string, unknown]>; statuses: unknown[] }>,
  /** The newest generation of the source run's first-run lineage (any status; the query filters). */
  existingContinue: null as { id: string; status: string } | null,
  continueQueries: [] as Array<{ eqs: Array<[string, unknown]>; statuses: unknown[] }>,
  continuationsReadError: null as { message: string } | null,
  orFilters: [] as string[],
  /** Other jobs rows (inserted wrappers, a preview run a final chain claims). */
  rows: {} as Record<string, Record<string, unknown>>,
  /** input_data written over a row (the claims). */
  writes: {} as Record<string, Record<string, unknown>>,
  estimateArgs: [] as unknown[],
  steps: 900,
  cover: { ok: true } as { ok: boolean; balance?: number },
  coverArgs: [] as unknown[],
}
export const m = {
  credits: true,
  denied: false,
  absent: false,
  authKind: "jwt" as "jwt" | "internal" | "api_token",
  reserveSeen: [] as Array<{ billingContext: unknown; creditOverride: unknown }>,
  insertJob: vi.fn(),
  insertIdem: vi.fn(),
  reserve: vi.fn(),
  execute: vi.fn(),
  stamp: vi.fn(),
  failed: vi.fn(async (..._a: unknown[]) => true),
  refund: vi.fn(async (..._a: unknown[]) => 1),
  existingByKey: null as { id: string } | null,
  stampThrows: false,
  guardCalls: 0,
  payer: undefined as unknown,
  seq: 0,
}
vi.mock("node:crypto", async (orig) => {
  const actual = await orig<typeof import("node:crypto")>()
  const randomUUID = () => `job-${++m.seq}`
  return { ...actual, randomUUID, default: { ...actual, randomUUID } }
})
vi.mock("@/lib/dedup-fingerprint.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/dedup-fingerprint.js")>()),
  findJobByIdempotencyKey: async () => m.existingByKey,
}))
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => m.credits }))
vi.mock("@/lib/availability-viewer.js", () => ({ isNodeDeniedForUser: async () => m.denied }))
vi.mock("@/lib/execution-inline-graph.js", () => ({
  ensureInlineGraphColumns: async () => !m.absent,
  inlineGraphColumnAbsent: () => false,
  loadInlineGraph: async (id: string) => {
    src.graphReads.push(id)
    return src.graph
  },
  findExecutionIdForWrapper: async () => src.foundExec,
}))
vi.mock("@/services/workflow-engine/run-continuation.js", async (orig) => ({
  ...(await orig<typeof import("@/services/workflow-engine/run-continuation.js")>()),
  loadContinuationSource: async () => src.source,
}))
vi.mock("@/lib/render-final-run.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/render-final-run.js")>()),
  renderFinalCredits: async (...a: unknown[]) => {
    src.finalCreditsArgs = a
    return src.finalCredits
  },
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob, insertJobIdempotent: m.insertIdem, billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {
    m.guardCalls++
  },
  reserveCreditsForJob: (req: FastifyRequest, ...rest: unknown[]) => {
    m.reserveSeen.push({ billingContext: req.billingContext, creditOverride: req.creditReservation?.creditOverride })
    return m.reserve(req, ...rest)
  },
  resolveWebSurfaceFlag: async () => false,
}))
vi.mock("@/services/use-case-execution.js", async (orig) => ({
  ...(await orig<typeof import("@/services/use-case-execution.js")>()),
  executeInlineGraph: m.execute,
}))
vi.mock("@/ee/billing/credits.js", async (orig) => ({
  // The price table and the charged-price rule the MCP verbs' credit hint reads (statedPrices).
  STATIC_CREDIT_COSTS: (await orig<typeof import("@/ee/billing/credits.js")>()).STATIC_CREDIT_COSTS,
  chargedPriceTableFrom: (await orig<typeof import("@/ee/billing/credits.js")>()).chargedPriceTableFrom,
  chargedCredits: (await orig<typeof import("@/ee/billing/credits.js")>()).chargedCredits,
  DEPLOYMENT_OUT_OF_CREDITS: "This deployment is out of credits. Contact your administrator.",
  estimateRunSetCredits: async (...a: unknown[]) => {
    src.estimateArgs = a
    return src.steps
  },
  CreditsService: {
    checkBalanceCovers: async (...a: unknown[]) => {
      src.coverArgs = a
      return src.cover
    },
  },
}))
/** A small in-memory `jobs` table: the source wrapper, other rows, and the input_data written over them. */
vi.mock("@/lib/supabase.js", () => {
  type Row = Record<string, unknown> & { id: string; input_data?: Record<string, unknown> }
  type Filter = { col: string; kind: "eq" | "is" | "in"; v: unknown }
  const rows = (): Row[] => {
    const all = [...Object.values(src.rows), ...(src.wrapper ? [src.wrapper] : [])] as Row[]
    return all.map((r) => (src.writes[r.id] ? { ...r, input_data: src.writes[r.id] } : r))
  }
  const valueOf = (row: Row, col: string): unknown => {
    if (col.startsWith("input_data->>")) {
      const v = row.input_data?.[col.slice("input_data->>".length)]
      return v === undefined || v === null ? null : String(v)
    }
    return row[col] ?? null
  }
  const matches = (row: Row, filters: Filter[]) =>
    filters.every((f) =>
      f.kind === "in" ? (f.v as unknown[]).includes(valueOf(row, f.col)) : f.kind === "is" ? valueOf(row, f.col) === f.v : valueOf(row, f.col) === f.v,
    )
  const knob = (filters: Filter[], field: string, list: typeof src.finalQueries, found: { id: string; status: string } | null) => {
    const eqs = filters.filter((f) => f.kind === "eq").map((f) => [f.col, f.v] as [string, unknown])
    const statuses = (filters.find((f) => f.kind === "in")?.v as unknown[]) ?? []
    list.push({ eqs, statuses })
    if (src.continuationsReadError) return { data: null, error: src.continuationsReadError }
    // A query for the edit a final rendered (`_finalEdit`) finds only a final recorded with that edit.
    const edit = eqs.find(([col]) => col === "input_data->>_finalEdit")?.[1]
    const sameEdit = edit === undefined || (found as { finalEdit?: string } | null)?.finalEdit === edit
    return { data: found && sameEdit && statuses.includes(found.status) ? { id: found.id, status: found.status } : null, error: null }
  }
  return {
    supabase: {
      from: () => {
        const filters: Filter[] = []
        let update: Record<string, unknown> | null = null
        const runUpdate = () => {
          const input = update!.input_data as Record<string, unknown>
          // The wrapper's stamp is the one update keyed by its id and its owner alone.
          if (filters.length === 2 && filters.some((f) => f.col === "id") && filters.some((f) => f.col === "user_id")) {
            if (m.stampThrows) throw new Error("socket hang up")
            m.stamp(update)
          }
          const hit = rows().filter((r) => matches(r, filters))
          for (const r of hit) src.writes[r.id] = input
          return hit.map((r) => ({ id: r.id }))
        }
        const q = {
          select: () => (update ? Promise.resolve().then(() => ({ data: runUpdate(), error: null })) : q),
          eq: (col: string, v: unknown) => (filters.push({ col, kind: "eq", v }), q),
          is: (col: string, v: unknown) => (filters.push({ col, kind: "is", v }), q),
          in: (col: string, v: unknown[]) => (filters.push({ col, kind: "in", v }), q),
          or: (filter: string) => (src.orFilters.push(filter), q),
          order: () => q,
          limit: () => q,
          update: (row: Record<string, unknown>) => ((update = row), q),
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => ({ data: runUpdate(), error: null }))
              .then(resolve, reject),
          maybeSingle: async () => {
            if (filters.some((f) => f.col === "input_data->>_finalOf")) return knob(filters, "_finalOf", src.finalQueries, src.existingFinal)
            if (filters.some((f) => f.col === "input_data->>_chainOf")) return knob(filters, "_chainOf", src.continueQueries, src.existingContinue)
            const isSource = src.wrapper && filters.some((f) => f.col === "id" && f.v === src.wrapper!.id)
            if (isSource && src.wrapperError) return { data: null, error: src.wrapperError }
            return { data: rows().find((r) => matches(r, filters)) ?? null, error: null }
          },
        }
        return q
      },
    },
  }
})
vi.mock("@/lib/job-failure.js", () => ({
  markJobFailed: async (id: string, ...rest: unknown[]) => {
    if (src.rows[id]) src.rows[id] = { ...src.rows[id], status: "failed" }
    return m.failed(id, ...rest)
  },
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))

export async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = m.authKind
    if (m.payer) req.billingContext = m.payer as never
  })
  // Loaded here, after this module's state exists: the mocks above read it.
  const { usecaseContinueRoutes } = await import("../../use-case-continue.js")
  await app.register(usecaseContinueRoutes)
  await app.ready()
  return app
}
export const post = async (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  (await makeApp()).inject({ method: "POST", url: "/v1/tighten-episode/continue", payload, headers })

export const nothingWritten = () => {
  expect(m.insertJob).not.toHaveBeenCalled()
  expect(m.insertIdem).not.toHaveBeenCalled()
  expect(m.reserve).not.toHaveBeenCalled()
  expect(m.execute).not.toHaveBeenCalled()
}

beforeEach(() => {
  Object.assign(m, { credits: true, denied: false, absent: false, authKind: "jwt", reserveSeen: [], existingByKey: null, stampThrows: false, guardCalls: 0, payer: undefined, seq: 0 })
  Object.assign(src, {
    wrapper: failedWrapper, wrapperError: null, graph, source: failedSource,
    finalCredits: { estimatedCredits: 600, sufficient: true, available: 5000 }, finalCreditsArgs: [], foundExec: null, graphReads: [],
    existingFinal: null, finalQueries: [], estimateArgs: [], steps: 900, cover: { ok: true }, coverArgs: [],
    existingContinue: null, continueQueries: [], continuationsReadError: null, orFilters: [], rows: {}, writes: {},
  })
  const record = (row: Record<string, unknown>) => {
    src.rows[row.id as string] = { ...row }
    return row.id as string
  }
  m.insertJob.mockReset().mockImplementation(async (_req: unknown, row: Record<string, unknown>) => ({ data: { id: record(row) }, error: null }))
  m.insertIdem.mockReset().mockImplementation(async (_req: unknown, row: Record<string, unknown>) => ({ created: true, row: { id: record(row) } }))
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.execute.mockReset().mockResolvedValue({ executionId: "exec-1", deduped: false })
  m.stamp.mockReset()
  for (const f of [m.failed, m.refund]) f.mockClear()
})


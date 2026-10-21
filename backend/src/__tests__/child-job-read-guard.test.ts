/**
 * A child job (`parent_job_id` set: a step a worker-side handler ran for its
 * parent) is shown only through its parent. Its `input_data` holds what the
 * handler sent on the user's behalf — for a Cast Swap run, the engine's own
 * prompt wording and a silent copy of the source clip — and the parent's
 * `output_data` names it, so the owner can learn its id. Every read that
 * answers a job BY ID must therefore refuse a child to a non-admin exactly as
 * it refuses a job that does not exist, and a trend run's failure text (which
 * can quote any hidden input) is replaced for non-admins.
 *
 * End to end over an in-memory `jobs` table whose fake applies the filters a
 * query asks for, so a read that forgets the child predicate returns the child
 * here as it would in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "community", PUBLIC_URL: "https://app.example.test", INTERNAL_ORCHESTRATOR_SECRET: "test-secret" },
  isCloud: () => false,
  hasCredits: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))
vi.mock("@/lib/job-credit-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/job-credit-status.js")>()),
  creditStatusMapFor: async () => new Map(),
}))
// The execution routes' queue and event plumbing (no Redis here).
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: vi.fn(), cancelRunningChildJobs: vi.fn() }))
vi.mock("@/lib/use-case/execution-wrappers.js", () => ({ liveUseCaseWrappersOf: vi.fn(async () => []) }))
vi.mock("@/lib/billing-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/billing-provider.js")>()),
  getBillingProvider: () => ({ report: async () => null }),
}))
vi.mock("@/lib/gallery-moderation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/gallery-moderation.js")>()
  return { ...actual, loadGalleryModeration: async () => actual.OWNER_VIEW_MODERATION }
})

import { supabase } from "../lib/supabase.js"
import { jobRoutes } from "../routes/jobs.js"
import { registerJobs } from "../lib/mcp/tools/jobs.js"
import { registerDiagnose } from "../lib/mcp/tools/diagnose.js"
import { registerGallery } from "../lib/mcp/tools/gallery.js"
import { newSession } from "../lib/mcp/session.js"
import type { Scope } from "../lib/scopes.js"
import { buildServer, callTool } from "../lib/mcp/tools/__tests__/_helpers.js"
import { planFromJob } from "../lib/mcp/tools/_studio-helpers.js"
import { registerUseCaseVerbs } from "../lib/mcp/tools/verbs-use-case.js"
import { workflowExecutionRoutes } from "../routes/workflow-execution.js"
import { galleryRoutes } from "../routes/gallery.js"
import { workflowCostRoutes } from "../routes/workflow-costs.js"
import { eventBodyFor, type ClaimedDelivery } from "../lib/webhooks/event.js"

// ── the seeded run ──────────────────────────────────────────────────────────

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const ADMIN = "00000000-0000-4000-8000-0000000000b2"
const PARENT = "11111111-1111-4111-8111-111111111111"
const CHILD = "22222222-2222-4222-8222-222222222222"
const MISSING = "33333333-3333-4333-8333-333333333333"
/** The Full Quality redo of the run, and the hidden upscale child it made. */
const FULL_QUALITY = "44444444-4444-4444-8444-444444444444"
const UPSCALE_CHILD = "55555555-5555-4555-8555-555555555555"
/** The run's reference-preparation child: a finished picture, so the gallery would list it. */
const PREP_CHILD = "77777777-7777-4777-8777-777777777777"

const ENGINE_WORDING = "ENGINE-WORDING-7f3a keep every gait and every cut"
const ROLE_NAME = "the-hidden-role-q9"
const TREND_PROMPT = "trend-prompt-secret-x4"
const REFERENCE_LINE = "reference-line-secret-k2"
const SOURCE_URL = "https://media.example.test/private/source-clip-z8.mp4"
const HIDDEN = [ENGINE_WORDING, ROLE_NAME, TREND_PROMPT, REFERENCE_LINE, SOURCE_URL, "source-clip-z8"]

const RUN_DIDNT_FINISH = "This run didn't finish."

function seedJobs(): Row[] {
  return [
    {
      id: PARENT,
      user_id: OWNER,
      parent_job_id: null,
      status: "failed",
      progress: 100,
      job_type: "cast-swap",
      is_public: false,
      input_data: {
        type: "cast-swap",
        trend: { slug: "the-trend", version: 3, name: { en: "The trend" } },
        slots: { lead: { images: ["https://media.example.test/me.png"] } },
        __videoUrl: SOURCE_URL,
        __roles: [{ kind: "person", name: ROLE_NAME }],
        __postPrompt: `${TREND_PROMPT} ${REFERENCE_LINE}`,
      },
      output_data: { __castSwapChildJobId: CHILD },
      // An engine failure can quote any hidden input.
      error_message: `cast-swap: the Seedance job failed for ${ROLE_NAME} (${ENGINE_WORDING})`,
      error_hint: null,
      error_detail: null,
      created_at: "2026-10-20T10:00:00.000Z",
      started_at: "2026-10-20T10:00:01.000Z",
      completed_at: "2026-10-20T10:02:00.000Z",
      credits: 40,
      usage_log_id: null,
      workflow_execution_id: null,
      session_id: null,
      source: "api",
      source_detail: null,
      reconcile_attempts: 0,
    },
    {
      id: CHILD,
      user_id: OWNER,
      parent_job_id: PARENT,
      status: "failed",
      progress: 100,
      job_type: "text-to-video",
      is_public: false,
      input_data: {
        type: "text-to-video",
        provider: "seedance-2-5",
        prompt: `${ENGINE_WORDING}. ${ROLE_NAME} becomes the person in @image1. ${TREND_PROMPT}. ${REFERENCE_LINE}.`,
        referenceVideoUrls: [SOURCE_URL],
        forcePrivate: true,
      },
      output_data: { videoUrl: "https://media.example.test/out/child.mp4" },
      error_message: `Provider rejected the prompt: "${ENGINE_WORDING}"`,
      error_hint: null,
      error_detail: null,
      created_at: "2026-10-20T10:00:05.000Z",
      started_at: "2026-10-20T10:00:06.000Z",
      completed_at: "2026-10-20T10:01:50.000Z",
      credits: 30,
      usage_log_id: null,
      workflow_execution_id: null,
      session_id: null,
      source: "api",
      source_detail: null,
      reconcile_attempts: 0,
    },
    {
      id: FULL_QUALITY,
      user_id: OWNER,
      parent_job_id: null,
      status: "processing",
      progress: 50,
      job_type: "cast-swap",
      is_public: false,
      input_data: {
        type: "cast-swap",
        fullQualityOf: PARENT,
        trend: { slug: "the-trend", version: 3, name: { en: "The trend" } },
        __draftJobId: PARENT,
      },
      output_data: { __castSwapFqChildJobId: UPSCALE_CHILD },
      error_message: null,
      error_hint: null,
      error_detail: null,
      created_at: "2026-10-20T12:00:00.000Z",
      started_at: "2026-10-20T12:00:01.000Z",
      completed_at: null,
      credits: 60,
      usage_log_id: null,
      workflow_execution_id: null,
      session_id: null,
      source: "api",
      source_detail: null,
      reconcile_attempts: 0,
    },
    {
      id: UPSCALE_CHILD,
      user_id: OWNER,
      parent_job_id: FULL_QUALITY,
      status: "completed",
      progress: 100,
      job_type: "video-upscale",
      is_public: false,
      input_data: {
        type: "video-upscale",
        provider: "seedance-2-5-hd",
        sourceJobId: CHILD,
        prompt: `${ENGINE_WORDING} ${ROLE_NAME}`,
        videoUrl: SOURCE_URL,
      },
      output_data: { videoUrl: "https://media.example.test/out/upscaled.mp4" },
      error_message: null,
      error_hint: null,
      error_detail: null,
      created_at: "2026-10-20T12:00:05.000Z",
      started_at: "2026-10-20T12:00:06.000Z",
      completed_at: "2026-10-20T12:03:00.000Z",
      credits: 20,
      usage_log_id: null,
      workflow_execution_id: null,
      session_id: null,
      source: "api",
      source_detail: null,
      reconcile_attempts: 0,
    },
    {
      id: PREP_CHILD,
      user_id: OWNER,
      parent_job_id: PARENT,
      status: "completed",
      progress: 100,
      job_type: "generate-image",
      is_public: false,
      input_data: {
        type: "generate-image",
        provider: "nano-banana-pro",
        prompt: `${ROLE_NAME}: one clean reference picture. ${ENGINE_WORDING}`,
        referenceImageUrls: ["https://media.example.test/me.png"],
      },
      output_data: { imageUrl: "https://media.example.test/out/prep.png" },
      error_message: null,
      error_hint: null,
      error_detail: null,
      created_at: "2026-10-20T10:00:02.000Z",
      started_at: "2026-10-20T10:00:02.500Z",
      completed_at: "2026-10-20T10:00:04.000Z",
      credits: 5,
      usage_log_id: null,
      workflow_execution_id: null,
      session_id: null,
      source: "api",
      source_detail: null,
      reconcile_attempts: 0,
    },
  ]
}

/** Every hidden child: the Seedance edit, the reference preparation and the Full Quality upscale. */
const CHILDREN = [CHILD, PREP_CHILD, UPSCALE_CHILD] as const

// ── an in-memory PostgREST that applies the filters it is given ─────────────

type Row = Record<string, unknown>
let tables: Record<string, Row[]>

/** Split on top-level commas (an embed's own list stays whole). */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** A column or a JSON path (`input_data->>type`, `input_data->trend`). */
function valueAt(row: Row, path: string): unknown {
  const parts = path.split(/->>?/)
  let v: unknown = row[parts[0]!]
  for (const p of parts.slice(1)) v = v && typeof v === "object" ? (v as Row)[p] : undefined
  if (path.includes("->>") && v !== undefined && v !== null && typeof v === "object") return JSON.stringify(v)
  return v === undefined ? null : v
}

function project(row: Row, select: string): Row {
  const out: Row = {}
  for (const token of splitTop(select)) {
    if (token === "*") {
      Object.assign(out, row)
      continue
    }
    if (token.includes("(")) {
      // An embed: nothing is joined in this fake (no execution, no favorite, no rating).
      const head = token.slice(0, token.indexOf("("))
      const name = (head.includes(":") ? head.split(":")[0]! : head.split("!")[0]!).trim()
      out[name] = null
      continue
    }
    const [alias, expr] = token.includes(":") ? [token.split(":")[0]!, token.split(":")[1]!] : [null, token]
    const key = alias ?? expr.split(/->>?/).pop()!
    out[key.trim()] = valueAt(row, expr.trim())
  }
  return out
}

type Pred = (row: Row) => boolean

function literal(v: string): unknown {
  if (v === "null") return null
  if (v === "true") return true
  if (v === "false") return false
  return v
}

function cmp(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual !== null && String(actual) === String(expected)
    case "neq":
      return actual !== null && String(actual) !== String(expected)
    case "is":
      return expected === null ? actual === null : actual === expected
    case "in":
      return (expected as unknown[]).map(String).includes(String(actual))
    case "lt":
      return actual !== null && String(actual) < String(expected)
    case "gt":
      return actual !== null && String(actual) > String(expected)
    default:
      throw new Error(`fake supabase: unsupported operator "${op}"`)
  }
}

/** `a.eq.x,and(b.eq.true,c.eq.done)` → a predicate. */
function orPredicate(expr: string): Pred {
  const terms = splitTop(expr).map((term): Pred => {
    if (term.startsWith("and(")) {
      const inner = splitTop(term.slice(4, -1)).map(orPredicate)
      return (row) => inner.every((p) => p(row))
    }
    if (term.startsWith("or(")) return orPredicate(term.slice(3, -1))
    const [col, op, ...rest] = term.split(".")
    const raw = rest.join(".")
    if (op === "ilike") {
      const needle = raw.replace(/^\*|\*$/g, "").toLowerCase()
      return (row) => String(valueAt(row, col!) ?? "").toLowerCase().includes(needle)
    }
    return (row) => cmp(op!, valueAt(row, col!), literal(raw))
  })
  return (row) => terms.some((p) => p(row))
}

function query(table: string) {
  const preds: Pred[] = []
  let select = "*"
  let countHead = false
  let order: { col: string; asc: boolean } | null = null
  let limit: number | null = null

  const rows = (): Row[] => {
    let out = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
    if (order) {
      const { col, asc } = order
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    if (limit !== null) out = out.slice(0, limit)
    return out.map((r) => project(r, select))
  }

  const builder: Record<string, unknown> = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      select = cols ?? "*"
      countHead = opts?.head === true
      return builder
    },
    eq: (c: string, v: unknown) => (preds.push((r) => cmp("eq", valueAt(r, c), v)), builder),
    neq: (c: string, v: unknown) => (preds.push((r) => cmp("neq", valueAt(r, c), v)), builder),
    is: (c: string, v: unknown) => (preds.push((r) => cmp("is", valueAt(r, c), v)), builder),
    in: (c: string, v: unknown[]) => (preds.push((r) => cmp("in", valueAt(r, c), v)), builder),
    lt: (c: string, v: unknown) => (preds.push((r) => cmp("lt", valueAt(r, c), v)), builder),
    gt: (c: string, v: unknown) => (preds.push((r) => cmp("gt", valueAt(r, c), v)), builder),
    not: (c: string, op: string, v: unknown) => (preds.push((r) => !cmp(op, valueAt(r, c), v)), builder),
    filter(c: string, op: string, v: string) {
      if (op === "not.in") {
        const list = v.replace(/^\(|\)$/g, "").split(",").filter(Boolean)
        preds.push((r) => !cmp("in", valueAt(r, c), list))
      } else preds.push((r) => cmp(op, valueAt(r, c), v))
      return builder
    },
    or: (expr: string) => (preds.push(orPredicate(expr)), builder),
    order(col: string, opts?: { ascending?: boolean }) {
      order = { col, asc: opts?.ascending !== false }
      return builder
    },
    limit: (n: number) => ((limit = n), builder),
    async single() {
      const r = rows()
      return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    },
    async maybeSingle() {
      const r = rows()
      return { data: r[0] ?? null, error: null }
    },
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      try {
        const r = rows()
        resolve(countHead ? { data: null, count: r.length, error: null } : { data: r, error: null, count: r.length })
      } catch (e) {
        reject?.(e)
      }
    },
  }
  for (const write of ["insert", "update", "upsert", "delete"]) {
    builder[write] = () => {
      throw new Error(`fake supabase: a read test wrote to "${table}" (${write})`)
    }
  }
  return builder
}

// ── the two faces: REST as the owner or an admin, MCP as the owner ──────────

let app: FastifyInstance
let as: { userId: string; userRole?: string }

beforeEach(async () => {
  tables = { jobs: seedJobs(), workflow_executions: [], gallery_favorites: [], job_ratings: [] }
  vi.mocked(supabase.from).mockImplementation(((table: string) => query(table)) as never)
  as = { userId: OWNER }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = as.userId
    ;(req as { userRole?: string }).userRole = as.userRole
  })
  await app.register(async (instance) => {
    await jobRoutes(instance)
    await workflowExecutionRoutes(instance)
    await galleryRoutes(instance)
    await workflowCostRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function mcp() {
  const server = buildServer()
  const session = newSession({ userId: OWNER, scopes: ["jobs:read", "assets:read"] as Scope[], clientName: "Claude" })
  const fastify = Fastify()
  registerJobs({ server, session, fastify })
  registerDiagnose({ server, session, fastify })
  registerGallery({ server, session, fastify })
  return server
}

function expectNoHidden(label: string, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  for (const secret of HIDDEN) {
    expect(text.includes(secret), `${label} leaked "${secret}": ${text.slice(0, 400)}`).toBe(false)
  }
}

async function rest(method: "GET" | "POST", url: string, payload?: object) {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}) })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

function delivery(jobId: string): ClaimedDelivery {
  return {
    deliveryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    webhookId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    userId: OWNER,
    jobId,
    event: "job.completed",
    payload: null,
    attempts: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
    url: "https://hooks.example.test/in",
    secretCiphertext: "sealed",
    previousSecretCiphertext: null,
    runtimeEnv: "production",
  } as ClaimedDelivery
}

describe("a child job read by id, as its owner (not an admin)", () => {
  it.each(CHILDREN)("GET /v1/jobs/:id answers the child %s exactly as a missing job", async (id) => {
    const child = await rest("GET", `/v1/jobs/${id}`)
    const missing = await rest("GET", `/v1/jobs/${MISSING}`)
    expect(child.status).toBe(404)
    expect(child.body).toEqual(missing.body)
    expectNoHidden("GET /v1/jobs/:child", child.body)
  })

  it.each(CHILDREN)("GET /v1/jobs/:id/status answers the child %s exactly as a missing job", async (id) => {
    const child = await rest("GET", `/v1/jobs/${id}/status`)
    const missing = await rest("GET", `/v1/jobs/${MISSING}/status`)
    expect(child.status).toBe(404)
    expect(child.body).toEqual(missing.body)
    expectNoHidden("GET /v1/jobs/:child/status", child.body)
  })

  it("GET /v1/jobs/status?ids= leaves the children out, as missing ids", async () => {
    const res = await rest("GET", `/v1/jobs/status?ids=${CHILDREN.join(",")},${MISSING}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ jobs: [] })
  })

  it("POST /v1/jobs/batch-status leaves the children out, as missing ids", async () => {
    const res = await rest("POST", "/v1/jobs/batch-status", { jobIds: [...CHILDREN, MISSING] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [] })
  })

  it.each(CHILDREN)("MCP get_job, wait_for_job, diagnose_run, get_asset and display_asset answer the child %s as not found", async (id) => {
    const server = mcp()
    for (const [tool, args] of [
      ["get_job", { job_id: id }],
      ["wait_for_job", { job_id: id, timeout_s: 1 }],
      ["diagnose_run", { id }],
      ["get_asset", { job_id: id }],
      ["display_asset", { job_id: id }],
    ] as const) {
      const res = await callTool(server, tool, args)
      expect(res.isError, `${tool} answered the child`).toBe(true)
      expect(res.content[0]?.text ?? "", tool).toMatch(/not found|isn't yours/i)
      expectNoHidden(tool, { content: res.content, structuredContent: res.structuredContent })
    }
  })

  it("the MCP helpers that read a job through GET /v1/jobs/:id answer a child as not found", async () => {
    // The real route, as the owner: the studio plan reader and continue_use_case.
    const routes = Fastify({ logger: false })
    routes.addHook("preHandler", async (req) => {
      req.userId = OWNER
    })
    await routes.register(async (instance) => {
      await jobRoutes(instance)
    })
    await routes.ready()
    const session = newSession({ userId: OWNER, scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })
    const server = buildServer()
    registerUseCaseVerbs({ server, session, fastify: routes })
    for (const id of CHILDREN) {
      const plan = await planFromJob(routes, session, id)
      expect(plan).toEqual({ status: 404, error: { code: "not_found", message: `Job ${id} not found` } })

      const res = await callTool(server, "continue_use_case", { job_id: id, mode: "from-failed" })
      expect(res.isError).toBe(true)
      expect(JSON.stringify(res.content)).toMatch(/not_found/)
      expectNoHidden("continue_use_case", res.content)
    }
    await routes.close()
  })

  it("MCP browse_gallery and list_favorites never list a child", async () => {
    tables.gallery_favorites = CHILDREN.map((id) => ({ user_id: OWNER, job_id: id, created_at: "2026-10-20T11:00:00.000Z" }))
    const server = mcp()
    for (const [tool, args] of [
      ["browse_gallery", { kinds: ["video"] }],
      ["list_favorites", {}],
    ] as const) {
      const res = await callTool(server, tool, args)
      expectNoHidden(tool, { content: res.content, structuredContent: res.structuredContent })
      for (const id of CHILDREN) expect(JSON.stringify(res.structuredContent ?? {}), tool).not.toContain(id)
    }
  })
})

describe("more reads a child must not reach, as its owner (not an admin)", () => {
  it.each(CHILDREN)("GET /v1/workflow-executions/:id answers the child %s as a missing execution", async (id) => {
    const child = await app.inject({ method: "GET", url: `/v1/workflow-executions/${id}` })
    const missing = await app.inject({ method: "GET", url: `/v1/workflow-executions/${MISSING}` })
    expect(child.statusCode).toBe(404)
    expect(child.json()).toEqual(missing.json())
    expectNoHidden("execution detail", child.body)
  })

  it.each(CHILDREN)("GET /v1/workflow-executions/:id/stream answers the child %s as a missing execution", async (id) => {
    const child = await app.inject({ method: "GET", url: `/v1/workflow-executions/${id}/stream` })
    const missing = await app.inject({ method: "GET", url: `/v1/workflow-executions/${MISSING}/stream` })
    expect(child.statusCode).toBe(404)
    expect(child.body).toEqual(missing.body)
    expectNoHidden("execution stream", child.body)
  })

  it("GET /v1/gallery?userId=<me> never lists a child, nor with favoritesOnly", async () => {
    tables.gallery_favorites = CHILDREN.map((job_id) => ({ user_id: OWNER, job_id, created_at: "2026-10-20T11:00:00.000Z" }))
    for (const url of [`/v1/gallery?userId=${OWNER}`, `/v1/gallery?userId=${OWNER}&favoritesOnly=true`]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode, url).toBe(200)
      expectNoHidden(url, res.body)
      for (const id of CHILDREN) expect(res.body, url).not.toContain(id)
    }
  })

  it.each(CHILDREN)("POST /v1/gallery/favorite refuses the child %s as a missing job", async (id) => {
    const child = await rest("POST", "/v1/gallery/favorite", { jobId: id })
    const missing = await rest("POST", "/v1/gallery/favorite", { jobId: MISSING })
    expect(child.status).toBe(404)
    expect(child.body).toEqual(missing.body)
  })

  it("POST /v1/jobs/cost-summary prices no child", async () => {
    const res = await rest("POST", "/v1/jobs/cost-summary", { jobIds: [...CHILDREN] })
    expect(res.status).toBe(200)
    expectNoHidden("cost-summary", res.body)
    expect(JSON.stringify(res.body)).not.toContain("seedance-2-5")
    expect((res.body.data as { total_jobs?: number } | undefined)?.total_jobs ?? (res.body as { total_jobs?: number }).total_jobs).toBe(0)
  })

  it.each(CHILDREN)("a webhook event for the child %s sends nothing (the job reads as gone)", async (id) => {
    expect(await eventBodyFor(delivery(id))).toEqual({ kind: "missing" })
  })

  it("MCP get_app_run never reads a child's prompt for its outputs, and favorite_asset refuses a child", async () => {
    tables.workflow_executions = [{
      id: "66666666-6666-4666-8666-666666666666", user_id: OWNER, workflow_id: null, status: "completed",
      trigger_type: "manual", trigger_data: null, error_message: null,
      created_at: "2026-10-20T13:00:00.000Z", started_at: "2026-10-20T13:00:00.000Z", completed_at: "2026-10-20T13:01:00.000Z",
      node_states: {
        n1: { status: "completed", nodeType: "video-upscale", jobId: UPSCALE_CHILD, output: { videoUrl: "https://media.example.test/out/upscaled.mp4" } },
      },
    }]
    const server = buildServer()
    const session = newSession({ userId: OWNER, scopes: ["jobs:read", "assets:read", "assets:write", "workflows:read"] as Scope[], clientName: "Claude" })
    registerGallery({ server, session, fastify: Fastify() })
    const exec = await callTool(server, "get_app_run", { execution_id: "66666666-6666-4666-8666-666666666666" })
    expectNoHidden("get_app_run", { content: exec.content, structuredContent: exec.structuredContent })
    for (const id of CHILDREN) {
      const fav = await callTool(server, "favorite_asset", { job_id: id, favorited: true })
      expect(fav.isError, `favorite_asset ${id}`).toBe(true)
    }
  })
})

describe("the trend run itself, as its owner (not an admin)", () => {
  it("every job read hides its hidden inputs and replaces its failure text", async () => {
    const reads = [
      await rest("GET", `/v1/jobs/${PARENT}`),
      await rest("GET", `/v1/jobs/${PARENT}/status`),
      await rest("GET", `/v1/jobs/status?ids=${PARENT}`),
      await rest("POST", "/v1/jobs/batch-status", { jobIds: [PARENT] }),
      await rest("GET", "/v1/jobs"),
    ]
    for (const [i, r] of reads.entries()) {
      expect(r.status, `read ${i}`).toBe(200)
      expectNoHidden(`REST read ${i}`, r.body)
      expect(JSON.stringify(r.body), `read ${i}`).toContain(RUN_DIDNT_FINISH)
      // The marker a lean read selects to know a trend run is never returned.
      expect(JSON.stringify(r.body), `read ${i}`).not.toContain("trend_run_marker")
    }
    // The list never shows a child either.
    const list = reads[4]!.body.data as Array<{ id: string }>
    expect(list.map((j) => j.id).sort()).toEqual([FULL_QUALITY, PARENT].sort())

    const server = mcp()
    for (const [tool, args] of [
      ["get_job", { job_id: PARENT }],
      ["wait_for_job", { job_id: PARENT, timeout_s: 1 }],
      ["list_jobs", { types: ["cast-swap"] }],
      ["diagnose_run", { id: PARENT }],
      ["get_asset", { job_id: PARENT }],
    ] as const) {
      const res = await callTool(server, tool, args)
      expectNoHidden(tool, { content: res.content, structuredContent: res.structuredContent })
      expect(JSON.stringify({ content: res.content, structuredContent: res.structuredContent }), tool).toContain(RUN_DIDNT_FINISH)
    }
  })
})

describe("an admin", () => {
  it("still reads the child, and the trend run's real failure", async () => {
    as = { userId: ADMIN, userRole: "admin" }
    const child = await rest("GET", `/v1/jobs/${CHILD}`)
    expect(child.status).toBe(200)
    expect(JSON.stringify(child.body)).toContain(ENGINE_WORDING)

    const status = await rest("GET", `/v1/jobs/${CHILD}/status`)
    expect(status.status).toBe(200)

    const batch = await rest("POST", "/v1/jobs/batch-status", { jobIds: [CHILD] })
    expect((batch.body.data as unknown[]).length).toBe(1)

    const upscale = await rest("GET", `/v1/jobs/${UPSCALE_CHILD}`)
    expect(upscale.status).toBe(200)
    expect((upscale.body.data as { input_data: { sourceJobId: string } }).input_data.sourceJobId).toBe(CHILD)
    const upscaleStatus = await rest("GET", `/v1/jobs/${UPSCALE_CHILD}/status`)
    expect(upscaleStatus.status).toBe(200)

    const parent = await rest("GET", `/v1/jobs/${PARENT}`)
    expect((parent.body.data as { error_message: string }).error_message).toContain(ROLE_NAME)

    // The execution surface keeps the admin read of a child of the admin's own.
    tables.jobs = tables.jobs.map((j) => (j.id === CHILD ? { ...j, user_id: ADMIN } : j))
    const exec = await app.inject({ method: "GET", url: `/v1/workflow-executions/${CHILD}` })
    expect(exec.statusCode).toBe(200)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `POST /v1/workflow-triggers` decides, once, whether a schedule's runs will
 * count as the workflow owner's OWN — the only lane on which a PLAIN stored
 * credential may travel. Only the owner's browser session qualifies. A
 * personal API token and an OAuth app token both run AS the owner (same
 * `req.userId`); uuid equality would have let either mint an owner-initiated
 * schedule aimed wherever `workflows:write` can point a node.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/lib/private-plugins/services-registry.js", async () => ({ getPluginServices: (await import("@/lib/private-plugins/load.js")).getPluginServices }))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))

vi.mock("@/lib/trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: vi.fn(async () => undefined),
  RUN_REQUIRES_AUTHENTICATED_MEMBER: "run_requires_authenticated_member",
}))

vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-context.js")>()
  return { ...actual, resolveBillingContext: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })) }
})

import { webhookTriggerRoutes } from "../webhook-triggers.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const EDITOR = "00000000-0000-4000-8000-0000000000ee"
const WF = "00000000-0000-4000-8000-000000000020"

type InsertRow = Record<string, unknown>

/**
 * `workflows` answers the ownership read; `workflow_triggers.insert` records
 * every row it is handed and answers from `answers` in order (so a test can
 * make the first attempt fail the way PostgREST does before migration 436).
 */
function tables(answers: Array<{ error?: { code: string; message: string } }> = [{}]) {
  const inserts: InsertRow[] = []
  let call = 0
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "workflows") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: WF, user_id: OWNER, workspace_id: null, visibility: "private" }, error: null }),
          }),
        }),
      }
    }
    if (table === "workflow_triggers") {
      return {
        insert: vi.fn((row: InsertRow) => {
          inserts.push(row)
          const answer = answers[Math.min(call++, answers.length - 1)]
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                answer.error ? { data: null, error: answer.error } : { data: { id: "trig-1", ...row, is_active: true }, error: null },
              ),
            }),
          }
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
  return inserts
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getPluginServices).mockReturnValue({
    orgs: {
      workflowAccess: vi.fn().mockResolvedValue("edit"),
      workflowAccessFromRow: vi.fn().mockResolvedValue("edit"),
      canDeleteWorkflow: vi.fn().mockResolvedValue(false),
      canRunWorkflow: vi.fn().mockResolvedValue(true),
      canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
      canShareWorkflow: vi.fn().mockResolvedValue(false),
    },
  } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })
  await app.register(async (i) => { await webhookTriggerRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const create = (userId: string, authKind: string) =>
  app.inject({
    method: "POST",
    url: "/v1/workflow-triggers",
    headers: { "x-user-id": userId, "x-auth-kind": authKind },
    payload: { workflowId: WF, type: "schedule", config: { interval: "1h" } },
  })

describe("POST /v1/workflow-triggers — owner_initiated is stamped from the request's auth kind", () => {
  it("the owner's own browser session: owner_initiated = true", async () => {
    const inserts = tables()
    const res = await create(OWNER, "jwt")
    expect(res.statusCode).toBe(201)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ workflow_id: WF, user_id: OWNER, type: "schedule", owner_initiated: true })
  })

  it("the owner through a personal API token: NOT owner-initiated, although it runs as the owner", async () => {
    const inserts = tables()
    const res = await create(OWNER, "api_token")
    expect(res.statusCode).toBe(201)
    expect(inserts[0]).toMatchObject({ user_id: OWNER })
    expect(inserts[0]).not.toHaveProperty("owner_initiated")
  })

  it("the owner through an OAuth app token: NOT owner-initiated", async () => {
    const inserts = tables()
    const res = await create(OWNER, "app_token")
    expect(res.statusCode).toBe(201)
    expect(inserts[0]).toMatchObject({ user_id: OWNER })
    expect(inserts[0]).not.toHaveProperty("owner_initiated")
  })

  it("a signed-in editor who is not the owner: NOT owner-initiated", async () => {
    const inserts = tables()
    const res = await create(EDITOR, "jwt")
    expect(res.statusCode).toBe(201)
    expect(inserts[0]).toMatchObject({ user_id: EDITOR })
    expect(inserts[0]).not.toHaveProperty("owner_initiated")
  })

  it("a database the column has not reached yet: the row is written again without the flag — never as owner-initiated", async () => {
    const inserts = tables([
      { error: { code: "PGRST204", message: "Could not find the 'owner_initiated' column of 'workflow_triggers' in the schema cache" } },
      {},
    ])
    const res = await create(OWNER, "jwt")
    expect(res.statusCode).toBe(201)
    expect(inserts).toHaveLength(2)
    expect(inserts[0]).toMatchObject({ owner_initiated: true })
    expect(inserts[1]).not.toHaveProperty("owner_initiated")
  })

  it("any other insert failure is a plain 500, not retried", async () => {
    const inserts = tables([{ error: { code: "23503", message: "fk" } }])
    const res = await create(OWNER, "jwt")
    expect(res.statusCode).toBe(500)
    expect(inserts).toHaveLength(1)
  })
})

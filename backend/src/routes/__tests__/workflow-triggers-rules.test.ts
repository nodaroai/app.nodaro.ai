import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `POST /v1/workflow-triggers` takes a schedule as RULES — the Schedule
 * Trigger node's model — and refuses what the cron could not honestly run:
 * an `every` outside the kind's range (refused, never clamped: a caller who
 * asked for every 24 months must hear no, not be quietly scheduled for 12),
 * a weeks rule with no weekday, a cron rule with no expression, an empty rule
 * list, a timezone the runtime cannot read. What it stores is normalised:
 * ids filled, fields the kind does not read dropped. The legacy
 * `interval` / `cron` pair is still accepted for rows made by hand.
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
const WF = "00000000-0000-4000-8000-000000000020"

type Row = Record<string, unknown>

/**
 * `workflows` answers the ownership read; `workflow_triggers` answers the
 * PATCH's row read with `existing` and records inserts and updates.
 */
function tables(existing: Row | null = { workflow_id: WF, config: {} }) {
  const inserts: Row[] = []
  const updates: Row[] = []
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
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }) }),
          }),
        }),
        insert: vi.fn((row: Row) => {
          inserts.push(row)
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "trig-1", ...row, is_active: true }, error: null }),
            }),
          }
        }),
        update: vi.fn((patch: Row) => {
          updates.push(patch)
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: "trig-1", workflow_id: WF, user_id: OWNER, type: "schedule", ...patch }, error: null }),
                }),
              }),
            }),
          }
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  }) as never)
  return { inserts, updates }
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
    req.userId = OWNER
    req.authKind = "jwt"
  })
  await app.register(async (i) => { await webhookTriggerRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const create = (config: Row) =>
  app.inject({ method: "POST", url: "/v1/workflow-triggers", payload: { workflowId: WF, type: "schedule", config } })

const patch = (config: Row) =>
  app.inject({ method: "PATCH", url: "/v1/workflow-triggers/00000000-0000-4000-8000-000000000077", payload: { config } })

describe("POST /v1/workflow-triggers — a schedule as rules", () => {
  it("stores the rules normalised, with the timezone and the max-execution count", async () => {
    const { inserts } = tables()
    const res = await create({
      rules: [
        { kind: "minutes", every: 20, hour: 5 },
        { id: "nine", kind: "weeks", every: 2, hour: 9, minute: 30, weekdays: [5, 1, 1] },
      ],
      timezone: "Asia/Jerusalem",
      maxExecutions: 10,
    })
    expect(res.statusCode).toBe(201)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].config).toEqual({
      rules: [
        { id: "rule-1", kind: "minutes", every: 20 },
        { id: "nine", kind: "weeks", every: 2, hour: 9, minute: 30, weekdays: [1, 5] },
      ],
      timezone: "Asia/Jerusalem",
      maxExecutions: 10,
    })
  })

  it("still takes the legacy interval / cron pair for a row made by hand", async () => {
    const { inserts } = tables()
    expect((await create({ interval: "1h" })).statusCode).toBe(201)
    expect((await create({ cron: "0 6 * * 1-5", timezone: "UTC" })).statusCode).toBe(201)
    expect(inserts.map((r) => r.config)).toEqual([{ interval: "1h" }, { cron: "0 6 * * 1-5", timezone: "UTC" }])
  })

  it.each([
    ["an every outside the kind's range", { rules: [{ kind: "months", every: 24 }] }],
    ["a weeks rule with no weekday", { rules: [{ kind: "weeks", hour: 9 }] }],
    ["a cron rule with no expression", { rules: [{ kind: "cron" }] }],
    ["a cron rule that is not 5 fields", { rules: [{ kind: "cron", cron: "0 6 * *" }] }],
    ["an unknown kind", { rules: [{ kind: "seconds", every: 30 }] }],
    ["an empty rule list", { rules: [] }],
    ["a timezone the runtime cannot read", { rules: [{ kind: "days", hour: 9 }], timezone: "Jerusalem" }],
    ["a minute out of range", { rules: [{ kind: "hours", every: 1, minute: 60 }] }],
  ])("refuses %s with a 400, storing nothing", async (_label, config) => {
    const { inserts } = tables()
    const res = await create(config)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(inserts).toHaveLength(0)
  })
})

describe("PATCH /v1/workflow-triggers/:id — a Telegram account row", () => {
  const ACCOUNT_ROW = { workflow_id: WF, type: "telegram_account", config: { nodeId: "ta1", accountId: "acc-1", chatIds: ["777"] } }
  const patchActive = (isActive: boolean) =>
    app.inject({ method: "PATCH", url: "/v1/workflow-triggers/00000000-0000-4000-8000-000000000077", payload: { isActive } })

  it("is never re-armed through the API — it is started in the editor", async () => {
    const { updates } = tables(ACCOUNT_ROW)
    const res = await patchActive(true)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("editor_only")
    expect(updates).toHaveLength(0)
  })

  it("is never re-configured through the API", async () => {
    const { updates } = tables(ACCOUNT_ROW)
    expect((await patch({ timezone: "UTC" })).statusCode).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it("can still be paused", async () => {
    const { updates } = tables(ACCOUNT_ROW)
    expect((await patchActive(false)).statusCode).toBe(200)
    expect(updates).toEqual([{ is_active: false }])
  })
})

describe("PATCH /v1/workflow-triggers/:id — the same rules, the same refusals, merged into the stored config", () => {
  const STORED = {
    workflow_id: WF,
    config: { rules: [{ id: "rule-1", kind: "minutes", every: 5 }], timezone: "UTC", nodeId: "s1", executionCount: 4 },
  }

  it("stores the rules normalised, on top of the row — the node link and the run count survive", async () => {
    const { updates } = tables(STORED)
    const res = await patch({ rules: [{ kind: "days", every: 3, hour: 7 }] })
    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{
      config: { rules: [{ id: "rule-1", kind: "days", every: 3, hour: 7, minute: 0 }], timezone: "UTC", nodeId: "s1", executionCount: 4 },
    }])
  })

  it("a PATCH of the timezone alone keeps the rules", async () => {
    const { updates } = tables(STORED)
    expect((await patch({ timezone: "Asia/Jerusalem" })).statusCode).toBe(200)
    expect(updates[0].config).toEqual({ ...STORED.config, timezone: "Asia/Jerusalem" })
  })

  it("a legacy key sent beside rules is not stored; sent alone it replaces them", async () => {
    const { updates } = tables(STORED)
    await patch({ rules: [{ kind: "hours", every: 2 }], interval: "5m" })
    expect(updates[0].config).toEqual({ rules: [{ id: "rule-1", kind: "hours", every: 2, minute: 0 }], timezone: "UTC", nodeId: "s1", executionCount: 4 })
    await patch({ interval: "10m" })
    expect(updates[1].config).toEqual({ interval: "10m", timezone: "UTC", nodeId: "s1", executionCount: 4 })
  })

  it("a row that is not the caller's is a 404, not a write", async () => {
    const { updates } = tables(null)
    expect((await patch({ timezone: "UTC" })).statusCode).toBe(404)
    expect(updates).toHaveLength(0)
  })

  it("refuses what the cron could not run", async () => {
    const { updates } = tables(STORED)
    expect((await patch({ rules: [{ kind: "minutes", every: 0 }] })).statusCode).toBe(400)
    expect((await patch({ timezone: "Mars/Olympus" })).statusCode).toBe(400)
    expect(updates).toHaveLength(0)
  })
})

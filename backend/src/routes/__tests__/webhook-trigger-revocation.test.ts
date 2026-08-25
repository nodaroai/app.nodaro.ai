import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A webhook trigger is the one capability in this product that outlives the
 * session that created it.
 *
 * The token is the authentication and it never expires. While only a
 * workflow's creator could mint one, "its owner may still run this workflow"
 * was true by construction and nothing had to check. Once a collaborator can
 * create one, it stops being true the moment the grant is revoked, the
 * membership is suspended, or the workspace is archived — and the URL would
 * keep firing, keep running the CURRENT graph, and keep writing results into
 * an execution row its owner is still allowed to read.
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

import { webhookTriggerRoutes } from "../webhook-triggers.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"
import { orchestrationQueue } from "../../lib/orchestration-queue.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const TRIGGER = "00000000-0000-4000-8000-000000000040"
const TOKEN = "a".repeat(64)

const TRIGGER_ROW = {
  id: TRIGGER,
  workflow_id: WF,
  user_id: OWNER,
  type: "webhook",
  config: {},
  is_active: true,
  last_triggered_at: null,
}

function plugin(canRun: boolean) {
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue(canRun ? "edit" : "none"),
    workflowAccessFromRow: vi.fn().mockResolvedValue(canRun ? "edit" : "none"),
    canDeleteWorkflow: vi.fn().mockResolvedValue(false),
    canRunWorkflow: vi.fn().mockResolvedValue(canRun),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
    canShareWorkflow: vi.fn().mockResolvedValue(false),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
  return orgs
}

/** The tables the fire path touches, in the order it touches them. */
function fireTables() {
  const triggerUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const execInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }),
    }),
  })

  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "workflow_triggers") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: TRIGGER_ROW, error: null }),
          }),
        }),
        update: triggerUpdate,
      }
    }
    // workflow_executions — the collision check, then the insert.
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
      insert: execInsert,
    }
  }) as never)

  return { triggerUpdate, execInsert }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => { await webhookTriggerRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("POST /v1/webhooks/:token — a trigger must not outlive its access", () => {
  it("refuses when the owner may no longer run the workflow, and does NOT deactivate", async () => {
    plugin(false)
    const { triggerUpdate, execInsert } = fireTables()

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/${TOKEN}`,
      payload: {},
    })

    // 404, the same answer an unknown token gets: whoever is holding a revoked
    // URL learns nothing about whether it was ever real.
    expect(res.statusCode).toBe(404)
    expect(execInsert).not.toHaveBeenCalled()
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
    // Refuse WITHOUT deactivating. `canRunWorkflow` returns false for a
    // transient outage the same as for a real revocation, so a write here
    // would turn a Redis blip into a permanently dead trigger. Refusing the one
    // fire is free to retry.
    expect(triggerUpdate).not.toHaveBeenCalled()
  })

  it("fires normally while the owner still may", async () => {
    plugin(true)
    const { execInsert } = fireTables()

    const res = await app.inject({
      method: "POST",
      url: `/v1/webhooks/${TOKEN}`,
      payload: {},
    })

    expect(res.statusCode).toBe(202)
    expect(execInsert).toHaveBeenCalled()
    expect(orchestrationQueue.add).toHaveBeenCalled()
  })
})

describe("PATCH /v1/workflow-triggers/:id — re-enabling is minting run access again", () => {
  const TRIGGER_ID = "00000000-0000-4000-8000-000000000041"

  /** The trigger PATCH reads the trigger's workflow, then updates. */
  function patchTables() {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { ...TRIGGER_ROW, id: TRIGGER_ID, is_active: true }, error: null,
            }),
          }),
        }),
      }),
    })
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { workflow_id: WF }, error: null }),
          }),
        }),
      }),
      update,
    } as never)
    return { update }
  }

  it("refuses isActive:true when the owner may no longer run the workflow", async () => {
    plugin(false)
    const { update } = patchTables()

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow-triggers/${TRIGGER_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { isActive: true },
    })

    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it("allows isActive:true while the owner still may", async () => {
    plugin(true)
    const { update } = patchTables()

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow-triggers/${TRIGGER_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { isActive: true },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalled()
  })

  it("does not ask when merely DISABLING (isActive:false)", async () => {
    const spy = plugin(false)
    const { update } = patchTables()

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow-triggers/${TRIGGER_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { isActive: false },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalled()
    // Turning a trigger OFF never needs run access — anyone who owns it may
    // stop it.
    expect(spy.canRunWorkflow).not.toHaveBeenCalled()
  })
})

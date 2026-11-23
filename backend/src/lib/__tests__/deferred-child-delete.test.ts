import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeDb } from "./helpers/fake-jobs-db.js"

/**
 * A delete never strands a held step (lib/deferred-child-delete.ts): the job,
 * workflow and project deletes release every held child in what they delete
 * BEFORE the cascade takes its row (its usage log would lose its job, still
 * reserved), and the funnel (lib/workflow-delete.ts) asks before its RPC.
 */

const db = vi.hoisted(() => ({ current: null as unknown as { from: (t: string) => unknown }, rpcOrder: [] as string[] }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => db.current.from(t),
    rpc: vi.fn(async (name: string) => {
      db.rpcOrder.push(`rpc:${name}`)
      return { data: { deleted: true, baseUrls: [] }, error: null }
    }),
  },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))
const money = vi.hoisted(() => ({ commitJobCredits: vi.fn(), refundLoopTrimAddon: vi.fn(), refundCredits: vi.fn() }))
vi.mock("@/workers/shared.js", () => ({ commitJobCredits: money.commitJobCredits, refundLoopTrimAddon: money.refundLoopTrimAddon }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: money.refundCredits } }))
vi.mock("@/lib/job-cover/cover-release.js", () => ({ readCoversInScope: vi.fn(async () => []) }))
vi.mock("@/lib/job-cover/cover-store.js", () => ({ releaseCoversOfJobs: vi.fn(async () => undefined) }))

import { heldChildrenInScope, releaseHeldChildrenBeforeDelete } from "../deferred-child-delete.js"
import { deleteJobWithPrivateMedia, deleteWorkflowWithPrivateMedia, deleteProjectWithPrivateMedia } from "../workflow-delete.js"

const USER = "00000000-0000-4000-8000-000000000001"
const RUN = "00000000-0000-4000-8000-0000000000a1"
const OTHER_RUN = "00000000-0000-4000-8000-0000000000a2"
const HELD = "00000000-0000-4000-8000-0000000000c1"
const OTHER_HELD = "00000000-0000-4000-8000-0000000000c2"
const WF = "00000000-0000-4000-8000-0000000000e1"
const PROJECT = "00000000-0000-4000-8000-0000000000d1"

let fake: FakeDb

function heldChild(id: string, parent: string, opts: { state?: string } = {}) {
  fake.tables.jobs!.push({
    id, status: "completed", input_data: { __deferSettlement: true }, user_id: USER, parent_job_id: parent, workflow_id: null,
    workflow_execution_id: null, completed_at: "2026-11-23T10:00:00Z", credits_actual: 40, billing_force_refund: false,
    held_completion_fields: { deferredSettlement: { version: 1, state: opts.state ?? "held", open: true, commit: {}, providerCost: 0.5, deferredAt: "x" } },
  })
  fake.tables.usage_logs!.push({ id: `log-${id}`, job_id: id, status: "reserved", credits_used: 40 })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.rpcOrder = []
  fake = new FakeDb()
  db.current = fake
  fake.tables.workflows = [{ id: WF, project_id: PROJECT, user_id: USER }]
  fake.tables.jobs!.push(
    { id: RUN, status: "processing", user_id: USER, parent_job_id: null, workflow_id: WF },
    { id: OTHER_RUN, status: "processing", user_id: USER, parent_job_id: null, workflow_id: null },
  )
  heldChild(HELD, RUN)
  heldChild(OTHER_HELD, OTHER_RUN)
  money.refundCredits.mockImplementation(async (logId: string) => {
    db.rpcOrder.push(`refund:${logId}`)
    const l = fake.row("usage_logs", logId)
    if (l?.status === "reserved") l.status = "refunded"
  })
  money.commitJobCredits.mockImplementation(async (logId: string) => {
    const l = fake.row("usage_logs", logId)
    if (l?.status === "reserved") l.status = "committed"
  })
})

describe("heldChildrenInScope", () => {
  it.each([
    ["the run's own delete", { jobId: RUN }, [HELD]],
    ["the child's own delete", { jobId: HELD }, [HELD]],
    ["its run's workflow", { workflowId: WF, userId: USER }, [HELD]],
    ["its run's project", { projectId: PROJECT, userId: USER }, [HELD]],
    ["another user's workflow of the same id", { workflowId: WF, userId: "00000000-0000-4000-8000-000000000009" }, []],
  ] as const)("%s", async (_label, scope, expected) => {
    expect((await heldChildrenInScope(scope))?.map((c) => c.id)).toEqual(expected)
  })
})

describe("releaseHeldChildrenBeforeDelete", () => {
  it("refunds the held child in scope and leaves the others", async () => {
    await releaseHeldChildrenBeforeDelete({ jobId: RUN })
    expect(fake.row("usage_logs", `log-${HELD}`)!.status).toBe("refunded")
    expect(fake.row("usage_logs", `log-${OTHER_HELD}`)!.status).toBe("reserved")
    expect(fake.row("jobs", HELD)!.credits_actual).toBe(0)
  })

  it("a child whose settle was decided (not landed) is settled, not refunded", async () => {
    fake.row("jobs", HELD)!.held_completion_fields = { deferredSettlement: { version: 1, state: "settled", open: true, commit: {}, providerCost: 0.5, deferredAt: "x" } }
    await releaseHeldChildrenBeforeDelete({ jobId: RUN })
    expect(fake.row("usage_logs", `log-${HELD}`)!.status).toBe("committed")
  })
})

describe("the delete funnel releases before its RPC", () => {
  it.each([
    ["a job delete", () => deleteJobWithPrivateMedia({ jobId: RUN, actorUserId: USER, isAdmin: false })],
    ["a workflow delete", () => deleteWorkflowWithPrivateMedia({ workflowId: WF, userId: USER })],
    ["a project delete", () => deleteProjectWithPrivateMedia({ projectId: PROJECT, userId: USER })],
  ])("%s", async (_label, del) => {
    await del()
    const refund = db.rpcOrder.indexOf(`refund:log-${HELD}`)
    const rpc = db.rpcOrder.findIndex((e) => e.startsWith("rpc:"))
    expect(refund).toBeGreaterThanOrEqual(0)
    expect(refund).toBeLessThan(rpc)
  })
})

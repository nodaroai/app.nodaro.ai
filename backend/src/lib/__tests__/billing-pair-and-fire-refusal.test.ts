// P14/W6+W7 — the payer pair on job/execution rows, and the visible
// tombstone a refused trigger fire leaves behind.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, insertCalls, latestExecution, probeError } = vi.hoisted(() => {
  const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = []
  const latestExecution: { value: Record<string, unknown> | null } = { value: null }
  const probeError: { value: { message: string } | null } = { value: null }
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "order", "limit", "update", "delete"]) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.maybeSingle = vi.fn().mockImplementation(async () =>
      probeError.value ? { data: null, error: probeError.value } : { data: latestExecution.value, error: null },
    )
    chain.single = vi.fn().mockResolvedValue({ data: { id: "row-1" }, error: null })
    chain.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      insertCalls.push({ table, row })
      return chain
    })
    return chain
  })
  return { mockFrom, insertCalls, latestExecution, probeError }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() } },
}))

import { billingPairColumns, withJobProvenance, insertInternalJob } from "../insert-job.js"
import { shouldRefuseDegradedRunFor } from "../billing-context.js"
import { recordTriggerFireRefusal, RUN_REQUIRES_AUTHENTICATED_MEMBER } from "../trigger-fire-refusal.js"
import type { BillingContext } from "../billing-context.js"

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "u-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

beforeEach(() => {
  insertCalls.length = 0
  latestExecution.value = null
  probeError.value = null
  mockFrom.mockClear()
})

describe("billingPairColumns (W7)", () => {
  it("a workspace payer yields the pair; personal and absent yield NOTHING (byte-identity)", () => {
    expect(billingPairColumns(WS_CTX)).toEqual({ workspace_id: "ws-1", org_id: "org-1" })
    expect(billingPairColumns({ payer: "user", userId: "u-1" })).toEqual({})
    expect(billingPairColumns(undefined)).toEqual({})
  })
})

describe("withJobProvenance (W7) — the ONE exception to caller-wins", () => {
  it("the resolved pair overrides a caller-supplied claim", () => {
    const req = { billingContext: WS_CTX, body: {}, headers: {} } as never
    const row = withJobProvenance(req, { user_id: "u-1", workspace_id: "caller-claim", org_id: "caller-claim" })
    expect(row.workspace_id).toBe("ws-1")
    expect(row.org_id).toBe("org-1")
  })

  it("a personal request adds no pair and leaves the caller's row untouched", () => {
    const req = { billingContext: { payer: "user", userId: "u-1" }, body: {}, headers: {} } as never
    const row = withJobProvenance(req, { user_id: "u-1" })
    expect(row).not.toHaveProperty("workspace_id")
    expect(row).not.toHaveProperty("org_id")
  })
})

describe("insertInternalJob (W7)", () => {
  it("stamps the carried context's pair onto the row", async () => {
    await insertInternalJob("test-lane", { user_id: "u-1", status: "pending" }, { billingContext: WS_CTX })
    const insert = insertCalls.find((c) => c.table === "jobs")
    expect(insert?.row).toMatchObject({ workspace_id: "ws-1", org_id: "org-1", source: "internal" })
  })

  it("no context ⇒ the row is byte-identical to pre-P14", async () => {
    await insertInternalJob("test-lane", { user_id: "u-1", status: "pending" })
    const insert = insertCalls.find((c) => c.table === "jobs")
    expect(insert?.row).not.toHaveProperty("workspace_id")
    expect(insert?.row).not.toHaveProperty("org_id")
  })
})

describe("recordTriggerFireRefusal (W6) — one visible tombstone, never spam", () => {
  it("writes ONE failed row carrying the stable code", async () => {
    await recordTriggerFireRefusal({ workflowId: "wf-1", userId: "u-1", triggerType: "schedule" })
    const insert = insertCalls.find((c) => c.table === "workflow_executions")
    expect(insert?.row).toMatchObject({
      workflow_id: "wf-1",
      user_id: "u-1",
      status: "failed",
      trigger_type: "schedule",
      error_message: RUN_REQUIRES_AUTHENTICATED_MEMBER,
    })
  })

  it("dedupes: when the LATEST execution is already this tombstone, nothing is written", async () => {
    latestExecution.value = {
      id: "prev",
      status: "failed",
      error_message: RUN_REQUIRES_AUTHENTICATED_MEMBER,
    }
    await recordTriggerFireRefusal({ workflowId: "wf-1", userId: "u-1", triggerType: "schedule" })
    expect(insertCalls.filter((c) => c.table === "workflow_executions")).toHaveLength(0)
  })

  it("writes again when a real run interleaved — the tombstone stays CURRENT", async () => {
    latestExecution.value = { id: "prev", status: "completed", error_message: null }
    await recordTriggerFireRefusal({ workflowId: "wf-1", userId: "u-1", triggerType: "webhook" })
    expect(insertCalls.filter((c) => c.table === "workflow_executions")).toHaveLength(1)
  })

  it("a bookkeeping failure never throws — a refusal must not become a crash loop", async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error("db down")
    })
    await expect(
      recordTriggerFireRefusal({ workflowId: "wf-1", userId: "u-1", triggerType: "telegram" }),
    ).resolves.toBeUndefined()
  })
})

describe("shouldRefuseDegradedRunFor — the ONE probe, FAIL-CLOSED (stage-9 review C2)", () => {
  const DEGRADED = { payer: "user" as const, userId: "u-1", degraded: true as const }

  it("degraded + workspace-homed ⇒ refuse", async () => {
    latestExecution.value = { workspace_id: "ws-1" }
    expect(await shouldRefuseDegradedRunFor(DEGRADED, "wf-1")).toBe(true)
  })

  it("degraded + personal-homed ⇒ proceed (the answer that work always had)", async () => {
    latestExecution.value = { workspace_id: null }
    expect(await shouldRefuseDegradedRunFor(DEGRADED, "wf-1")).toBe(false)
  })

  it("degraded + UNREADABLE home ⇒ refuse — failing open would bill the member in exactly the outage this guards", async () => {
    probeError.value = { message: "db blip" }
    expect(await shouldRefuseDegradedRunFor(DEGRADED, "wf-1")).toBe(true)
  })

  it("a healthy context never probes at all", async () => {
    expect(await shouldRefuseDegradedRunFor({ payer: "user", userId: "u-1" }, "wf-1")).toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

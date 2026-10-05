import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A schedule trigger must not outlive its owner's access either.
 *
 * The webhook fire path re-checks on every fire; the cron is the OTHER path
 * that fires triggers, and it fires them unattended, forever, on an interval.
 * A collaborator who created a schedule trigger and then lost the grant, was
 * suspended, or watched the workspace be archived must stop being served — the
 * same revocation-survival threat the webhook path closes.
 *
 * The second half: whether a schedule's runs count as the OWNER'S OWN (so a
 * plain stored credential may travel) is a stored fact about the trigger,
 * decided when it was created — never re-derived from uuid equality here,
 * which would say "owner" for a token-created schedule too.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))
vi.mock("@/lib/workflow-access.js", () => ({
  canRunWorkflow: vi.fn(),
}))

import { checkScheduledTriggers } from "../schedule-cron.js"
import { supabase } from "../supabase.js"
import { orchestrationQueue } from "../orchestration-queue.js"
import { canRunWorkflow } from "../workflow-access.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

const DUE_TRIGGER = {
  id: "trig-1",
  workflow_id: WF,
  user_id: OWNER,
  // A bare interval with no prior fire is due immediately.
  config: { interval: "5m", nodeId: "sched-node" },
  last_triggered_at: null,
}

/**
 * The tables the loop touches: the trigger list, the trigger's stored
 * provenance (`owner_initiated`), then (only if it gets that far) the
 * collision check and the execution insert. Records the collision check's
 * filters so a test can assert it is scoped to the owner.
 *
 * `provenance`: what the `owner_initiated` read answers — a boolean, `null`
 * (no row / no column yet on this database) or `"throws"`.
 */
function tables(opts: { provenance?: boolean | null | "throws" } = {}) {
  const provenance = opts.provenance === undefined ? true : opts.provenance
  const collisionEq2 = vi.fn().mockReturnValue({
    in: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  })
  const collisionEq1 = vi.fn().mockReturnValue({ eq: collisionEq2 })
  const execInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }),
    }),
  })
  const triggerUpdate = claimableUpdate()
  const provenanceEq = vi.fn().mockReturnValue({
    maybeSingle:
      provenance === "throws"
        ? vi.fn().mockRejectedValue(new Error("column \"owner_initiated\" does not exist"))
        : vi.fn().mockResolvedValue({ data: provenance === null ? null : { owner_initiated: provenance }, error: null }),
  })

  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "workflow_triggers") {
      return {
        select: vi.fn((columns: string) =>
          columns === "owner_initiated"
            ? { eq: provenanceEq }
            : { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [DUE_TRIGGER], error: null }) }) },
        ),
        update: triggerUpdate,
      }
    }
    return {
      select: vi.fn().mockReturnValue({ eq: collisionEq1 }),
      insert: execInsert,
    }
  }) as never)

  return { collisionEq1, collisionEq2, execInsert, provenanceEq }
}

const enqueuedWith = (partial: Record<string, unknown>) =>
  expect(orchestrationQueue.add).toHaveBeenCalledWith("workflow-execution", expect.objectContaining(partial), expect.anything())

/**
 * A `workflow_triggers` update as the cron issues it: the tick claim
 * (`.eq("id").eq|is("last_triggered_at").select("id")`, answered as won) and
 * the run count (`.eq("id")`, awaited directly).
 */
function claimableUpdate() {
  return vi.fn(() => {
    const chain: Record<string, unknown> = {}
    chain.eq = vi.fn(() => chain)
    chain.is = vi.fn(() => chain)
    chain.select = vi.fn(async () => ({ data: [{ id: "trig-1" }], error: null }))
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return chain
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("checkScheduledTriggers — access is re-checked before every fire", () => {
  it("does NOT fire when the owner may no longer run the workflow", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(false)
    const { execInsert } = tables()

    await checkScheduledTriggers()

    expect(canRunWorkflow).toHaveBeenCalledWith(OWNER, WF)
    expect(execInsert).not.toHaveBeenCalled()
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
  })

  it("fires, and scopes the collision check to the owner, while access holds", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(true)
    const { collisionEq1, collisionEq2, execInsert } = tables()

    await checkScheduledTriggers()

    expect(execInsert).toHaveBeenCalled()
    // …naming the node the row was projected from, so the worker runs its branch.
    enqueuedWith({ triggerType: "schedule", triggerNodeId: "sched-node" })
    // The already-running check is scoped to the owner, not workflow-wide —
    // otherwise one member's manual run suppresses another member's schedule.
    expect(collisionEq1).toHaveBeenCalledWith("workflow_id", WF)
    expect(collisionEq2).toHaveBeenCalledWith("user_id", OWNER)
  })
})

describe("checkScheduledTriggers — owner-initiated is the trigger's STORED provenance", () => {
  it("a schedule the backend stored as owner-initiated enqueues ownerInitiated: true, read by trigger id", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(true)
    const { provenanceEq } = tables({ provenance: true })

    await checkScheduledTriggers()

    expect(provenanceEq).toHaveBeenCalledWith("id", "trig-1")
    enqueuedWith({ triggerType: "schedule", ownerInitiated: true })
  })

  it("a schedule stored as NOT owner-initiated (token-created, projected from a graph write) enqueues false — uuid equality does not rescue it", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(true)
    // DUE_TRIGGER.user_id IS the owner; the stored answer still wins.
    tables({ provenance: false })

    await checkScheduledTriggers()

    enqueuedWith({ ownerInitiated: false })
  })

  it("no provenance row (the column has not reached this database) fails closed, and the schedule still fires", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(true)
    const { execInsert } = tables({ provenance: null })

    await checkScheduledTriggers()

    expect(execInsert).toHaveBeenCalled()
    enqueuedWith({ ownerInitiated: false })
  })

  it("a provenance read that throws fails closed, and the schedule still fires", async () => {
    vi.mocked(canRunWorkflow).mockResolvedValue(true)
    const { execInsert } = tables({ provenance: "throws" })

    await checkScheduledTriggers()

    expect(execInsert).toHaveBeenCalled()
    enqueuedWith({ ownerInitiated: false })
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The graph is the single source of truth for a node-managed schedule. A row
 * whose Schedule Trigger node is gone from the stored graph is an orphan —
 * some save lane did not project the removal — and an orphan that keeps
 * firing runs the whole workflow forever with no surface to stop it. The cron
 * drops it, but only when it READ the graph and the node is absent; an
 * unreadable graph changes nothing this tick.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))
vi.mock("@/lib/workflow-access.js", () => ({
  canRunWorkflow: vi.fn().mockResolvedValue(true),
}))

import { checkScheduledTriggers } from "../schedule-cron.js"
import { supabase } from "../supabase.js"
import { orchestrationQueue } from "../orchestration-queue.js"

const OWNER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

const managed = (nodeId: string | null) => ({
  id: "trig-1",
  workflow_id: WF,
  user_id: OWNER,
  config: nodeId ? { interval: "5m", nodeId } : { interval: "5m" },
  last_triggered_at: null,
})

/**
 * `workflow_triggers` (list + provenance read + delete), `workflows` (the
 * graph read behind the orphan check), and `workflow_executions` (collision
 * check + insert). Records deletes and whether a run was enqueued.
 */
function tables(opts: { trigger: ReturnType<typeof managed>; graph: Array<{ id: string; type: string }> | null | "error" }) {
  const deletes: string[] = []
  const deleteEq = vi.fn((_col: string, id: string) => {
    deletes.push(id)
    return Promise.resolve({ data: null, error: null })
  })
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "workflow_triggers") {
      return {
        select: vi.fn((columns: string) =>
          columns === "owner_initiated"
            ? { eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { owner_initiated: false }, error: null }) }) }
            : { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [opts.trigger], error: null }) }) },
        ),
        update: claimableUpdate(),
        delete: vi.fn().mockReturnValue({ eq: deleteEq }),
      }
    }
    if (table === "workflows") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle:
              opts.graph === "error"
                ? vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
                : vi.fn().mockResolvedValue({ data: opts.graph ? { nodes: opts.graph } : null, error: null }),
          }),
        }),
      }
    }
    // workflow_executions: the collision check, then the insert.
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }) }),
      }),
    }
  }) as never)
  return { deletes }
}

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

beforeEach(() => vi.clearAllMocks())

describe("checkScheduledTriggers — a node-managed row outlives its node", () => {
  it("drops the row and does not fire when the graph no longer carries the node", async () => {
    const { deletes } = tables({ trigger: managed("s1"), graph: [{ id: "t1", type: "text-prompt" }] })
    await checkScheduledTriggers()
    expect(deletes).toEqual(["trig-1"])
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
  })

  it("fires as usual while the node is on the graph", async () => {
    const { deletes } = tables({ trigger: managed("s1"), graph: [{ id: "s1", type: "schedule-trigger" }] })
    await checkScheduledTriggers()
    expect(deletes).toEqual([])
    expect(orchestrationQueue.add).toHaveBeenCalledTimes(1)
  })

  it("an unreadable graph changes nothing this tick: no delete, still fires", async () => {
    const { deletes } = tables({ trigger: managed("s1"), graph: "error" })
    await checkScheduledTriggers()
    expect(deletes).toEqual([])
    expect(orchestrationQueue.add).toHaveBeenCalledTimes(1)
  })

  it("a row somebody created by hand (no nodeId) is never judged against the graph", async () => {
    const { deletes } = tables({ trigger: managed(null), graph: [{ id: "t1", type: "text-prompt" }] })
    await checkScheduledTriggers()
    expect(deletes).toEqual([])
    expect(orchestrationQueue.add).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A schedule trigger must not outlive its owner's access either.
 *
 * The webhook fire path re-checks on every fire; the cron is the OTHER path
 * that fires triggers, and it fires them unattended, forever, on an interval.
 * A collaborator who created a schedule trigger and then lost the grant, was
 * suspended, or watched the workspace be archived must stop being served — the
 * same revocation-survival threat the webhook path closes.
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
  config: { interval: "5m" },
  last_triggered_at: null,
}

/**
 * The tables the loop touches: the trigger list, then (only if it gets that
 * far) the collision check and the execution insert. Records the collision
 * check's filters so a test can assert it is scoped to the owner.
 */
function tables() {
  const collisionEq2 = vi.fn().mockReturnValue({
    in: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  })
  const collisionEq1 = vi.fn().mockReturnValue({ eq: collisionEq2 })
  const execInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }),
    }),
  })
  const triggerUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })

  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (table === "workflow_triggers") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [DUE_TRIGGER], error: null }),
          }),
        }),
        update: triggerUpdate,
      }
    }
    return {
      select: vi.fn().mockReturnValue({ eq: collisionEq1 }),
      insert: execInsert,
    }
  }) as never)

  return { collisionEq1, collisionEq2, execInsert }
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
    expect(orchestrationQueue.add).toHaveBeenCalled()
    // The already-running check is scoped to the owner, not workflow-wide —
    // otherwise one member's manual run suppresses another member's schedule.
    expect(collisionEq1).toHaveBeenCalledWith("workflow_id", WF)
    expect(collisionEq2).toHaveBeenCalledWith("user_id", OWNER)
  })
})

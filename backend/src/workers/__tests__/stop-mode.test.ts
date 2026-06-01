/**
 * L2#4 — Orchestrator stop-mode (cancelled vs stopping).
 *
 * The orchestrator dispatch loop polls `checkExecutionControl(executionId)`
 * between every level. The function maps the DB execution status to one
 * of three control signals:
 *   - "cancelled" — user wants immediate stop. Orchestrator stops
 *     dispatching new levels.
 *   - "stopping" — user wants to finish current level then stop.
 *     Orchestrator also stops dispatching new levels (the in-flight
 *     level finishes naturally because no one cancels it).
 *   - "running" — keep going.
 *
 * Bug class: status mapping silently breaks (e.g., a new "halting" status
 * isn't classified). The orchestrator keeps dispatching levels for
 * minutes after the user clicks Cancel.
 *
 * This file covers the helper directly. The full dispatch loop is L3
 * integration territory (out of scope for Phase 3) — but the structural
 * check below verifies that the orchestrator source code DOES branch on
 * both control statuses, so a future refactor that loses one of them
 * fails CI.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: supabaseMock }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

import { checkExecutionControl } from "../orchestrator-worker.js"

beforeEach(() => {
  supabaseMock.from.mockReset()
})

function mockExecutionStatus(status: string | null) {
  const singleMock = vi.fn().mockResolvedValue({
    data: status === null ? null : { status },
    error: null,
  })
  const eqMock = vi.fn().mockReturnValue({ single: singleMock })
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
  supabaseMock.from.mockReturnValue({ select: selectMock })
}

// ---------------------------------------------------------------------------
// Test 1 — checkExecutionControl status mapping.
// ---------------------------------------------------------------------------

describe("checkExecutionControl — status mapping", () => {
  it('returns "cancelled" when DB status is "cancelled"', async () => {
    mockExecutionStatus("cancelled")
    expect(await checkExecutionControl("exec-1")).toBe("cancelled")
  })

  it('returns "stopping" when DB status is "stopping"', async () => {
    mockExecutionStatus("stopping")
    expect(await checkExecutionControl("exec-1")).toBe("stopping")
  })

  it('returns "discarded" when DB status is "discarded"', async () => {
    mockExecutionStatus("discarded")
    expect(await checkExecutionControl("exec-1")).toBe("discarded")
  })

  it('returns "running" when DB status is "running"', async () => {
    mockExecutionStatus("running")
    expect(await checkExecutionControl("exec-1")).toBe("running")
  })

  it('returns "running" when DB row is missing (defensive default)', async () => {
    mockExecutionStatus(null)
    expect(await checkExecutionControl("exec-missing")).toBe("running")
  })

  it.each([
    "completed",
    "failed",
    "pending",
    "queued",
    "unknown_status",
  ])('returns "running" for any other status (%s) — only the two explicit halt signals trigger stop', async (status) => {
    mockExecutionStatus(status)
    expect(await checkExecutionControl("exec-1")).toBe("running")
  })

  it("uses the workflow_executions table", async () => {
    mockExecutionStatus("running")
    await checkExecutionControl("exec-1")
    expect(supabaseMock.from).toHaveBeenCalledWith("workflow_executions")
  })
})

// ---------------------------------------------------------------------------
// Test 2 — structural check that the orchestrator dispatch loop branches
// on BOTH "cancelled" AND "stopping". Catches the regression where a
// refactor accidentally drops one of the branches.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const ORCHESTRATOR_SRC = readFileSync(
  join(REPO_ROOT, "backend/src/workers/orchestrator-worker.ts"),
  "utf8",
)

describe("orchestrator-worker.ts dispatch loop branches on both stop modes", () => {
  it('contains a "controlStatus === \\"cancelled\\"" branch', () => {
    expect(
      /controlStatus\s*===\s*"cancelled"/.test(ORCHESTRATOR_SRC),
      `orchestrator-worker.ts no longer branches on \`controlStatus === "cancelled"\` — the user's Cancel click won't propagate. Re-add the check after \`checkExecutionControl(executionId)\`.`,
    ).toBe(true)
  })

  it('contains a "controlStatus === \\"stopping\\"" branch', () => {
    expect(
      /controlStatus\s*===\s*"stopping"/.test(ORCHESTRATOR_SRC),
      `orchestrator-worker.ts no longer branches on \`controlStatus === "stopping"\` — the "Stop after current level" UX is broken. Re-add the check after \`checkExecutionControl(executionId)\`.`,
    ).toBe(true)
  })

  it("both branches set ctx.cancelled = true (so in-flight nodes bail out)", () => {
    // Find the cancelled branch + the next ~10 lines, look for ctx.cancelled = true
    const cancelledMatch = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"cancelled"[\s\S]{0,200}?ctx\.cancelled\s*=\s*true/,
    )
    expect(
      cancelledMatch,
      `The cancelled branch in orchestrator-worker.ts no longer sets ctx.cancelled = true within ~200 chars. In-flight iteration tasks won't see the cancel signal — workflow will keep running invisibly.`,
    ).not.toBeNull()

    const stoppingMatch = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"stopping"[\s\S]{0,200}?ctx\.cancelled\s*=\s*true/,
    )
    expect(
      stoppingMatch,
      `The stopping branch in orchestrator-worker.ts no longer sets ctx.cancelled = true within ~200 chars.`,
    ).not.toBeNull()
  })

  it("both branches mark the execution status as cancelled in the DB", () => {
    // After the branch, the execution should be updated with status: "cancelled".
    // We grep within ~400 chars for both branches.
    const cancelledBlock = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"cancelled"[\s\S]{0,400}?status:\s*"cancelled"/,
    )
    expect(
      cancelledBlock,
      `The cancelled branch doesn't update the execution status to "cancelled" in the DB within 400 chars — the UI won't reflect the cancellation.`,
    ).not.toBeNull()

    const stoppingBlock = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"stopping"[\s\S]{0,400}?status:\s*"cancelled"/,
    )
    expect(
      stoppingBlock,
      `The stopping branch doesn't update the execution status to "cancelled" in the DB within 400 chars. Note: stopping → cancelled is by design (the user-visible terminal state is the same; "stopping" is just a transient signal).`,
    ).not.toBeNull()
  })

  it("both branches emit the execution:cancelled event", () => {
    const cancelledEvent = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"cancelled"[\s\S]{0,500}?type:\s*"execution:cancelled"/,
    )
    expect(
      cancelledEvent,
      `The cancelled branch doesn't emit an execution:cancelled event within 500 chars — SSE subscribers won't see the cancellation.`,
    ).not.toBeNull()

    const stoppingEvent = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"stopping"[\s\S]{0,500}?type:\s*"execution:cancelled"/,
    )
    expect(
      stoppingEvent,
      `The stopping branch doesn't emit an execution:cancelled event within 500 chars.`,
    ).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 3 — structural check that the orchestrator dispatch loop has a
// DEDICATED "discarded" branch that is SEPARATE from the cancelled/stopping
// branch. "discarded" = Discard Run: stop scheduling new levels, but DO NOT
// cancel in-flight jobs and DO NOT rewrite the status to "cancelled" (the
// frontend needs the "discarded" status to detach the canvas).
//
// Folding "discarded" into the shared cancelled||stopping branch would erase
// the status the frontend depends on — these structural guards lock that in.
// ---------------------------------------------------------------------------

describe("orchestrator-worker.ts has a dedicated discarded branch", () => {
  it('contains a "controlStatus === \\"discarded\\"" branch', () => {
    expect(
      /controlStatus\s*===\s*"discarded"/.test(ORCHESTRATOR_SRC),
      `orchestrator-worker.ts no longer branches on \`controlStatus === "discarded"\` — Discard Run won't stop scheduling new levels. Re-add a dedicated branch after \`checkExecutionControl(executionId)\`.`,
    ).toBe(true)
  })

  it('the discarded branch is NOT folded into the cancelled||stopping condition', () => {
    // Guard against a regression that ORs "discarded" into the shared branch
    // (which overwrites status to "cancelled" and cancels in-flight jobs).
    expect(
      /controlStatus\s*===\s*"cancelled"\s*\|\|\s*controlStatus\s*===\s*"stopping"\s*\|\|\s*controlStatus\s*===\s*"discarded"/.test(
        ORCHESTRATOR_SRC,
      ),
      `"discarded" must NOT be ORed into the cancelled||stopping branch — that branch overwrites the execution status to "cancelled" and cancels in-flight jobs, erasing the "discarded" status the frontend needs. Use a separate \`if (controlStatus === "discarded")\` branch.`,
    ).toBe(false)
    // And the reverse fold ordering.
    expect(
      /controlStatus\s*===\s*"discarded"\s*\|\|\s*controlStatus\s*===\s*"(cancelled|stopping)"/.test(
        ORCHESTRATOR_SRC,
      ),
      `"discarded" must NOT be ORed with cancelled/stopping. Use a separate branch.`,
    ).toBe(false)
  })

  it('the discarded branch writes status: "discarded" (NOT "cancelled")', () => {
    const discardedBlock = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"discarded"[\s\S]{0,400}?status:\s*"discarded"/,
    )
    expect(
      discardedBlock,
      `The discarded branch doesn't update the execution status to "discarded" within 400 chars — the frontend won't detach the canvas. It must write status: "discarded" (not "cancelled").`,
    ).not.toBeNull()

    // The discarded branch must NOT write status: "cancelled" before it writes
    // status: "discarded" — otherwise it would clobber the status the frontend
    // needs. We assert there's no `status: "cancelled"` between the discarded
    // branch start and its `status: "discarded"` write.
    const discardedToCancelled = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"discarded"[\s\S]{0,400}?status:\s*"cancelled"/,
    )
    expect(
      discardedToCancelled,
      `The discarded branch writes status: "cancelled" — it must write status: "discarded" instead, so the frontend can distinguish a discard from a cancel.`,
    ).toBeNull()
  })

  it("the discarded branch emits the execution:discarded event (terminal SSE)", () => {
    const discardedEvent = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"discarded"[\s\S]{0,500}?type:\s*"execution:discarded"/,
    )
    expect(
      discardedEvent,
      `The discarded branch doesn't emit an execution:discarded event within 500 chars — SSE subscribers won't get a terminal "done" on discard.`,
    ).not.toBeNull()
  })

  it("the discarded branch does NOT set ctx.cancelled = true or cancel in-flight jobs", () => {
    // In-flight jobs must finish naturally into My Library. The discarded
    // branch must not set ctx.cancelled (which would make iteration tasks bail)
    // nor call cancelJobAndThrow.
    const discardedSetsCancelled = ORCHESTRATOR_SRC.match(
      /controlStatus\s*===\s*"discarded"[\s\S]{0,400}?ctx\.cancelled\s*=\s*true/,
    )
    expect(
      discardedSetsCancelled,
      `The discarded branch sets ctx.cancelled = true — but Discard Run must let in-flight jobs finish into My Library. Remove that assignment from the discarded branch.`,
    ).toBeNull()
  })
})

describe("orchestrator-worker.ts stalled re-pick guard treats discarded as terminal", () => {
  it("the stalled re-pick guard includes 'discarded' (a discarded run must not be re-executed/re-charged)", () => {
    // A BullMQ stalled re-pick of a TERMINAL execution must short-circuit.
    // 'discarded' sets completed_at and is terminal; omitting it would let a
    // crashed-then-discarded run be re-executed, re-reserving credits for a run
    // the user explicitly discarded. Find the guard array and assert membership.
    const guard = ORCHESTRATOR_SRC.match(
      /\[\s*"completed"\s*,\s*"failed"\s*,\s*"cancelled"[^\]]*\]\.includes\(\s*execRow\.status/,
    )
    expect(
      guard,
      "Could not find the stalled re-pick terminal-status guard (\"completed\",\"failed\",\"cancelled\",...].includes(execRow.status)).",
    ).not.toBeNull()
    expect(guard![0]).toContain('"discarded"')
  })
})

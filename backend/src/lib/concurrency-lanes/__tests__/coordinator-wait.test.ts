// @test-reads-none an in-memory database double; reads no repo file
// creditCoordinatorWait: a running job's in-handler wait is credited to its
// own scope and its row — and to nothing once its scope has ended. Detached
// work that kept a finished job's async context (a timer, a late callback)
// must not add to that job's figure or write its row: a `pipelines` row's
// write has no status guard to stop it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeSweepDb, type SweepDb } from "./fake-sweep-db.js"

const h = vi.hoisted(() => ({ db: null as unknown as { client: { from(t: string): unknown } } }))
vi.mock("../../supabase.js", () => ({ supabase: { from: (t: string) => h.db.client.from(t) } }))

const { creditCoordinatorWait, flushCoordinatorWaitForTests } = await import("../coordinator-wait.js")
const { runHolding, currentHoldScope, heldWaitOf } = await import("../hold.js")
const { resetLaneColumnsForTests } = await import("../columns.js")
type ConcurrencyHold = import("../hold.js").ConcurrencyHold

const PIPELINE = "00000000-0000-4000-8000-0000000000e1"
const hold: ConcurrencyHold = { role: "run", lane: "run", userId: "U", payer: "user:U", tier: null, jobId: PIPELINE, leaseId: null, waitTable: "pipelines" }
let db: SweepDb

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  db.rows("pipelines").push({ id: PIPELINE, user_id: "U", status: "running", lane_wait_ms: 0 })
  resetLaneColumnsForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("creditCoordinatorWait", () => {
  it("control: a wait inside a live scope is credited and written to the row", async () => {
    await runHolding(hold, async () => {
      creditCoordinatorWait(1_000, 61_000)
      await flushCoordinatorWaitForTests()
    })
    expect(db.row("pipelines", PIPELINE)?.lane_wait_ms).toBe(60_000)
  })

  it("a wait reported after the job's scope closed is not credited and writes nothing", async () => {
    let late: Promise<void> | null = null
    let scopeWait = -1
    await runHolding(hold, async () => {
      // Detached work: a timer started inside the job fires after it ended, in its async context.
      late = new Promise<void>((resolve) => {
        setTimeout(async () => {
          creditCoordinatorWait(1_000, 61_000)
          await flushCoordinatorWaitForTests()
          scopeWait = heldWaitOf(currentHoldScope()!.wait)
          resolve()
        }, 5)
      })
    })
    await late
    expect(scopeWait).toBe(0)
    expect(db.row("pipelines", PIPELINE)?.lane_wait_ms).toBe(0)
    expect(db.writes).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_TURN_WAITERS, MAX_WAITING_BYTES, createEditorProjectGates } from "../gates.js"

/**
 * The user's heavy turn (`gates.ts`): a request that may not wait is refused 429 `busy` while another runs; one that
 * waits (a closing page's last save, `x-release`) is handed the turn the moment it is given back, in arrival order,
 * and refused `busy` past its wait or past the waiters one user may have.
 */

const gates = () => createEditorProjectGates({ max: 30, windowMs: 60_000 })
const busy = expect.objectContaining({ status: 429, code: "busy" })
/** `fn` throws the 429 `busy` refusal. */
function refusedBusy(fn: () => unknown) {
  let thrown: unknown = null
  try {
    fn()
  } catch (err) {
    thrown = err
  }
  expect(thrown).toEqual(busy)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("waiting for the heavy turn", () => {
  it("is granted at once when the turn is free, and holds it like any turn", async () => {
    const g = gates()
    const end = await g.awaitHeavyTurn("u1", 5_000)
    refusedBusy(() => g.heavyTurn("u1"))
    end()
    g.heavyTurn("u1")()
  })

  it("is handed the turn when the running request gives it back; a plain request meanwhile is still busy", async () => {
    const g = gates()
    const end = g.heavyTurn("u1")
    let granted: (() => void) | null = null
    void g.awaitHeavyTurn("u1", 5_000).then((next) => (granted = next))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(granted).toBeNull()
    end()
    await vi.advanceTimersByTimeAsync(0)
    expect(granted).not.toBeNull()
    // Handed over, never free in between: a request that does not wait is refused.
    refusedBusy(() => g.heavyTurn("u1"))
    granted!()
    g.heavyTurn("u1")()
  })

  it("hands the turn over in arrival order", async () => {
    const g = gates()
    const end = g.heavyTurn("u1")
    const order: string[] = []
    const first = g.awaitHeavyTurn("u1", 5_000).then((next) => (order.push("first"), next))
    const second = g.awaitHeavyTurn("u1", 5_000).then((next) => (order.push("second"), next))
    end()
    ;(await first)()
    ;(await second)()
    expect(order).toEqual(["first", "second"])
  })

  it("is refused busy once its wait passes, and leaves the line", async () => {
    const g = gates()
    const end = g.heavyTurn("u1")
    const waited = g.awaitHeavyTurn("u1", 5_000)
    const outcome = waited.then(() => "granted", (err: unknown) => err)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await outcome).toEqual(busy)
    // Gone from the line: the turn given back is free, not handed to it.
    end()
    g.heavyTurn("u1")()
  })

  it(`is refused busy at once past ${MAX_TURN_WAITERS} waiting for one user, while another user's turn is untouched`, async () => {
    const g = gates()
    const end = g.heavyTurn("u1")
    const waiting = Array.from({ length: MAX_TURN_WAITERS }, () => g.awaitHeavyTurn("u1", 5_000))
    await expect(g.awaitHeavyTurn("u1", 5_000)).rejects.toEqual(busy)
    g.heavyTurn("u2")()
    end()
    for (const turn of waiting) (await turn)()
  })

  it("is refused busy at once when the bodies already waiting on this instance, every user's together, would pass the cap", async () => {
    const g = createEditorProjectGates({ max: 30, windowMs: 60_000 }, { maxWaitingBytes: 100 })
    const one = g.heavyTurn("u1")
    const two = g.heavyTurn("u2")
    const first = g.awaitHeavyTurn("u1", 5_000, 60)
    await expect(g.awaitHeavyTurn("u2", 5_000, 50)).rejects.toEqual(busy)
    // A turn handed over frees its bytes: room again.
    one()
    ;(await first)()
    const second = g.awaitHeavyTurn("u2", 5_000, 50)
    two()
    ;(await second)()
    expect(MAX_WAITING_BYTES).toBe(64 * 1024 * 1024)
  })

  it("a waiter refused for its wait frees its bytes too", async () => {
    const g = createEditorProjectGates({ max: 30, windowMs: 60_000 }, { maxWaitingBytes: 100 })
    const end = g.heavyTurn("u1")
    const waited = g.awaitHeavyTurn("u1", 5_000, 90).catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await waited).toEqual(busy)
    const next = g.awaitHeavyTurn("u1", 5_000, 90)
    end()
    ;(await next)()
  })

  it("a turn given back twice hands over only once", async () => {
    const g = gates()
    const end = g.heavyTurn("u1")
    const next = g.awaitHeavyTurn("u1", 5_000)
    end()
    end()
    const granted = await next
    refusedBusy(() => g.heavyTurn("u1"))
    granted()
  })
})

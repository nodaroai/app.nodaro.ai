import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NodaroError, NotFoundError, RateLimitedError } from "@nodaro/sdk/errors"
import { collectVariadic, parseCount, watchTraining, watchUntilTerminal } from "../util.js"

/**
 * `watchUntilTerminal` is the one place the CLI decides what a `--watch` run
 * MEANS: which statuses stop the loop, what the user reads, and which exit code
 * a shell script sees. The job-policy release (spec
 * 2026-09-03-job-policy-hook-design §6.4) adds a fourth outcome —
 * `pending_review`, a job parked on a human reviewer. It is IN-FLIGHT, not
 * terminal, so it must never join the terminal set; but the loop has to stop
 * anyway, because "keep polling" here means polling until the CLI is killed.
 * Exit 3 is its own code precisely so a script can tell "a human is deciding"
 * apart from `failed` (2) and `cancelled` (130).
 */

/** `process.exit` is mocked to throw this so the polling loop unwinds. */
class ExitCalled extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

let logged: string[]
let written: string[]

beforeEach(() => {
  logged = []
  written = []
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "))
  })
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    written.push(String(chunk))
    return true
  }) as never)
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitCalled(code)
  }) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A fetch closure that answers with each status in order, repeating the last. */
function statuses(...list: string[]) {
  let i = 0
  return vi.fn(async () => {
    const status = list[Math.min(i, list.length - 1)]
    i += 1
    return { data: { status } } as { data: { status: never } }
  })
}

describe("collectVariadic / parseCount", () => {
  it("collectVariadic accumulates repeated flag occurrences", () => {
    expect(collectVariadic("b", collectVariadic("a", undefined))).toEqual(["a", "b"])
  })

  it("parseCount coerces to the 1 | 2 | 4 union and defaults to 1", () => {
    expect(parseCount("2")).toBe(2)
    expect(parseCount("4")).toBe(4)
    expect(parseCount("3")).toBe(1)
    expect(parseCount(undefined)).toBe(1)
  })
})

describe("watchUntilTerminal — the existing terminal outcomes", () => {
  it("returns on completed without exiting", async () => {
    const fetch = statuses("completed")
    const result = await watchUntilTerminal({ fetch, label: "job-1", intervalMs: 1 })
    expect(result.data.status).toBe("completed")
    expect(process.exit).not.toHaveBeenCalled()
    expect(logged.join("\n")).toContain("completed in")
  })

  it("exits 2 on failed", async () => {
    const fetch = statuses("failed")
    await expect(watchUntilTerminal({ fetch, label: "job-1", intervalMs: 1 })).rejects.toMatchObject({
      code: 2,
    })
  })

  it("exits 130 on cancelled", async () => {
    const fetch = statuses("cancelled")
    await expect(watchUntilTerminal({ fetch, label: "job-1", intervalMs: 1 })).rejects.toMatchObject({
      code: 130,
    })
  })
})

describe("watchUntilTerminal — a job held for review", () => {
  it("stops on pending_review, says it is not a failure, and exits 3", async () => {
    const fetch = statuses("processing", "pending_review")
    await expect(watchUntilTerminal({ fetch, label: "job-9", intervalMs: 1 })).rejects.toMatchObject({
      code: 3,
    })
    // Exactly two ticks: it stopped ON the held one rather than polling until
    // the process is killed.
    expect(fetch).toHaveBeenCalledTimes(2)
    const out = logged.join("\n")
    expect(out).toContain("awaiting review")
    expect(out).toContain("a human decision is pending; not a failure")
  })

  it("pending_review is NOT treated as terminal: the transition line still prints it", async () => {
    const fetch = statuses("pending_review")
    await expect(watchUntilTerminal({ fetch, label: "job-9", intervalMs: 1 })).rejects.toBeInstanceOf(
      ExitCalled,
    )
    expect(logged.join("\n")).toContain("job-9 → pending_review")
  })

  it("--json emits the held payload and returns, mirroring the failed/cancelled json arms", async () => {
    // Deliberate symmetry with the terminal branch above it: in `--json` mode
    // `watchUntilTerminal` reports the payload and lets the caller decide, for
    // every non-completed outcome. Changing that for `pending_review` alone
    // would make one status behave unlike the other three.
    const fetch = statuses("pending_review")
    const result = await watchUntilTerminal({ fetch, label: "job-9", intervalMs: 1, json: true })
    expect(result.data.status).toBe("pending_review")
    expect(process.exit).not.toHaveBeenCalled()
    expect(JSON.parse(written.join(""))).toMatchObject({ status: "pending_review" })
  })
})

/**
 * `watchTraining` is `watchUntilTerminal` for a character's training, whose
 * vocabulary is its own (`queued` → `training` → `succeeded` | `failed` |
 * `cancelled`, and `untrained` when nothing is in flight). Same exit codes a
 * script already knows: 0 succeeded, 2 failed, 130 cancelled.
 */
describe("watchTraining", () => {
  /** A fetch closure answering each training status in order, repeating the last. */
  function trainingStatuses(...list: Array<string | { status: string; error?: string | null }>) {
    let i = 0
    return vi.fn(async () => {
      const entry = list[Math.min(i, list.length - 1)]!
      i += 1
      return typeof entry === "string" ? { status: entry, error: null } : { error: null, ...entry }
    })
  }

  it("polls through queued and training, prints each transition, and returns on succeeded", async () => {
    const fetch = trainingStatuses("queued", "training", "training", "succeeded")
    const result = await watchTraining({ fetch, label: "char-1", intervalMs: 1 })
    expect(result.status).toBe("succeeded")
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(process.exit).not.toHaveBeenCalled()
    const out = logged.join("\n")
    expect(out).toContain("char-1 → queued")
    expect(out).toContain("char-1 → training")
    expect(out).toContain("char-1 → succeeded")
    // One line per transition, not per poll.
    expect(out.match(/→ training/g)).toHaveLength(1)
  })

  it("exits 2 on failed and says why", async () => {
    const fetch = trainingStatuses("training", { status: "failed", error: "upstream failed" })
    await expect(watchTraining({ fetch, label: "char-1", intervalMs: 1 })).rejects.toMatchObject({ code: 2 })
    expect(logged.join("\n")).toContain("upstream failed")
  })

  it("exits 130 on cancelled", async () => {
    const fetch = trainingStatuses("training", "cancelled")
    await expect(watchTraining({ fetch, label: "char-1", intervalMs: 1 })).rejects.toMatchObject({ code: 130 })
  })

  it("untrained on the first poll: nothing in flight, nothing to wait for — returns without exiting", async () => {
    const fetch = trainingStatuses("untrained")
    const result = await watchTraining({ fetch, label: "char-1", intervalMs: 1 })
    expect(result.status).toBe("untrained")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(process.exit).not.toHaveBeenCalled()
    expect(logged.join("\n")).toContain("no training in flight")
  })

  it("untrained after `training`: only a removal clears a running training — exits 130", async () => {
    const fetch = trainingStatuses("training", "untrained")
    await expect(watchTraining({ fetch, label: "char-1", intervalMs: 1 })).rejects.toMatchObject({ code: 130 })
    expect(logged.join("\n")).toContain("removed")
  })

  // The route releases a slot it claimed (`queued`) by resetting the status to
  // untrained when the training cannot be started (`training_dispatch_failed`,
  // refunded) — a failure, not a removal.
  it("untrained straight after `queued`: the training could not be started — exits 2", async () => {
    const fetch = trainingStatuses("queued", "untrained")
    await expect(watchTraining({ fetch, label: "char-1", intervalMs: 1 })).rejects.toMatchObject({ code: 2 })
    expect(logged.join("\n")).toContain("could not be started")
  })

  it("--json emits the final record and returns, whatever the outcome", async () => {
    const fetch = trainingStatuses("training", { status: "failed", error: "upstream failed" })
    const result = await watchTraining({ fetch, label: "char-1", intervalMs: 1, json: true })
    expect(result.status).toBe("failed")
    expect(process.exit).not.toHaveBeenCalled()
    expect(JSON.parse(written.join(""))).toMatchObject({ status: "failed", error: "upstream failed" })
  })

  it("a failed poll is retried at the next tick instead of ending the watch", async () => {
    let calls = 0
    const fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error("socket hang up")
      return { status: "succeeded", error: null }
    })
    const result = await watchTraining({ fetch, label: "char-1", intervalMs: 1 })
    expect(result.status).toBe("succeeded")
    expect(logged.join("\n")).toContain("poll failed (will retry): socket hang up")
  })

  it("a 5xx or a 429 is transient too: retried", async () => {
    const answers: Array<() => { status: string; error: null }> = [
      () => {
        throw new NodaroError("Request failed", "internal_error", 503)
      },
      () => {
        throw new RateLimitedError()
      },
      () => ({ status: "succeeded", error: null }),
    ]
    let i = 0
    const fetch = vi.fn(async () => answers[i++]!())
    const result = await watchTraining({ fetch, label: "char-1", intervalMs: 1 })
    expect(result.status).toBe("succeeded")
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("a definitive 4xx ends the watch with that error instead of polling forever", async () => {
    const fetch = vi.fn(async () => {
      throw new NotFoundError("Not found")
    })
    await expect(watchTraining({ fetch, label: "char-1", intervalMs: 1 })).rejects.toBeInstanceOf(NotFoundError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

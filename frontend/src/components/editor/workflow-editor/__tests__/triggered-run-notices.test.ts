/**
 * What the open editor says about runs it did not start (a Telegram post, a
 * webhook, a schedule): history says nothing, a new run says "started", an
 * ended one says how it ended — once — and the editor's own runs say nothing.
 */
import { describe, it, expect } from "vitest"
import { diffTriggeredRuns, pickResultNode, runEndOf, type NoticeRun, type SeenRuns } from "../triggered-run-notices"
import type { NodeState } from "../../execution-utils"

const run = (id: string, status: string, triggerType = "telegram_account"): NoticeRun => ({ id, status, triggerType })

/** Looks at each page in turn, as the poll does, and returns every notice in order. */
function look(...pages: NoticeRun[][]) {
  let seen: SeenRuns | null = null
  const all: { executionId: string; kind: string }[] = []
  for (const rows of pages) {
    const result = diffTriggeredRuns(seen, rows)
    seen = result.seen
    all.push(...result.notices.map((n) => ({ executionId: n.executionId, kind: n.kind })))
  }
  return all
}

describe("diffTriggeredRuns", () => {
  it("the first look is history: nothing to tell, whatever it holds", () => {
    expect(look([run("a", "running"), run("b", "completed"), run("c", "failed")])).toEqual([])
  })

  it("a new run says it started, then how it ended — once", () => {
    expect(
      look([], [run("a", "pending")], [run("a", "running")], [run("a", "completed")], [run("a", "completed")]),
    ).toEqual([
      { executionId: "a", kind: "started" },
      { executionId: "a", kind: "finished" },
    ])
  })

  it("a failed or timed-out run says it failed", () => {
    expect(look([], [run("a", "running"), run("b", "running")], [run("a", "failed"), run("b", "timed_out")])).toEqual([
      { executionId: "a", kind: "started" },
      { executionId: "b", kind: "started" },
      { executionId: "a", kind: "failed" },
      { executionId: "b", kind: "failed" },
    ])
  })

  it("a run first seen already over says how it ended", () => {
    expect(look([], [run("a", "completed")])).toEqual([{ executionId: "a", kind: "finished" }])
  })

  it("a run stopped on purpose says nothing more", () => {
    expect(look([], [run("a", "running")], [run("a", "cancelled")], [run("b", "discarded")])).toEqual([
      { executionId: "a", kind: "started" },
    ])
  })

  it("the editor's own runs (a Run, a single node) say nothing", () => {
    expect(look([], [run("m", "running", "manual"), run("s", "running", "single-node")], [run("m", "completed", "manual")])).toEqual([])
  })

  it("every other lane does: webhook, schedule, the Telegram bot", () => {
    expect(look([], [run("w", "running", "webhook"), run("s", "running", "schedule"), run("t", "running", "telegram")]).map((n) => n.executionId)).toEqual([
      "w",
      "s",
      "t",
    ])
  })
})

describe("runEndOf", () => {
  it("is the one check for an ended run: a time-out is a failure, a stop is not an end", () => {
    expect(runEndOf("completed")).toBe("finished")
    expect(runEndOf("failed")).toBe("failed")
    expect(runEndOf("timed_out")).toBe("failed")
    expect(runEndOf("cancelled")).toBeNull()
    expect(runEndOf("running")).toBeNull()
  })
})

describe("pickResultNode", () => {
  const state = (over: Partial<NodeState>): NodeState => ({ status: "completed", startedAt: "2026-10-02T14:21:08Z", ...over })

  it("is the last executed node that produced something", () => {
    const picked = pickResultNode({
      trig: state({ startedAt: undefined, output: { text: "the message" } }),
      first: state({ jobId: "j1", completedAt: "2026-10-02T14:21:10Z" }),
      last: state({ output: { text: "ideas" }, completedAt: "2026-10-02T14:21:25Z" }),
      note: state({ completedAt: "2026-10-02T14:21:30Z" }),
      skipped: { status: "skipped" },
    }, "completed")
    expect(picked?.nodeId).toBe("last")
  })

  it("is nothing when no node ran", () => {
    expect(pickResultNode({ trig: state({ startedAt: undefined, output: { text: "x" } }) }, "completed")).toBeNull()
  })

  it("for a failed run, is the node that failed, not an earlier one that worked", () => {
    const picked = pickResultNode({
      worked: state({ jobId: "j1", completedAt: "2026-10-02T14:21:10Z" }),
      broke: { status: "failed", error: "no video", jobId: "j2" },
    }, "failed")
    expect(picked?.nodeId).toBe("broke")
  })

  it("skips a fanned-out node (its items open one by one in the list)", () => {
    const picked = pickResultNode({
      single: state({ jobId: "j1", completedAt: "2026-10-02T14:21:10Z" }),
      fanned: state({ jobId: "b", jobIds: ["a", "b"], completedAt: "2026-10-02T14:21:20Z" }),
    }, "completed")
    expect(picked?.nodeId).toBe("single")
  })
})

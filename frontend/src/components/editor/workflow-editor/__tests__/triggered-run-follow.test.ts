/**
 * Which Telegram-started run the canvas follows or shows, and which of its
 * node states it may paint: never over something the editor ran since, never
 * a trigger node's message, a pass-through node, a node cleared after the
 * run, or a node already showing that run.
 */
import { describe, it, expect } from "vitest"
import {
  RESULTS_RUN_ID_KEY,
  activeFollowedIds,
  endedRunToShow,
  paintableStates,
  runToFollow,
  triggerNodesOf,
  type FollowRun,
} from "../triggered-run-follow"

const run = (id: string, status: string, triggerType = "telegram_account", completedAt?: string): FollowRun => ({
  id,
  status,
  triggerType,
  ...(completedAt ? { completedAt } : {}),
})

describe("runToFollow", () => {
  it("is the newest Telegram run still going, not one already handled", () => {
    const rows = [run("new", "running"), run("older", "pending"), run("done", "completed")]
    expect(runToFollow(rows, new Set())?.id).toBe("new")
    expect(runToFollow(rows, new Set(["new"]))?.id).toBe("older")
  })

  it("is nothing for runs on other lanes: a schedule or a webhook is not followed", () => {
    expect(runToFollow([run("s", "running", "schedule"), run("w", "running", "webhook"), run("m", "running", "manual")], new Set())).toBeNull()
  })

  it("takes the bot trigger's lane too", () => {
    expect(runToFollow([run("b", "running", "telegram")], new Set())?.id).toBe("b")
  })
})

describe("endedRunToShow", () => {
  it("is the newest Telegram run once it ended, past runs on lanes the canvas leaves alone", () => {
    expect(endedRunToShow([run("hook", "completed", "webhook"), run("t2", "completed"), run("t1", "completed")])?.id).toBe("t2")
    expect(endedRunToShow([run("t", "failed")])?.id).toBe("t")
    expect(endedRunToShow([run("t", "timed_out")])?.id).toBe("t")
  })

  it("is nothing when the editor ran something since: its own result is newer", () => {
    expect(endedRunToShow([run("m", "completed", "manual"), run("t", "completed")])).toBeNull()
    expect(endedRunToShow([run("n", "completed", "single-node"), run("t", "completed")])).toBeNull()
  })

  it("is nothing while a newer Telegram run is still going (that one is followed), or when the newest was stopped", () => {
    expect(endedRunToShow([run("live", "running"), run("t", "completed")])).toBeNull()
    expect(endedRunToShow([run("stopped", "cancelled"), run("t", "completed")])).toBeNull()
  })
})

describe("paintableStates", () => {
  const nodes = [
    { id: "trig", type: "telegram-account-trigger", data: {} },
    { id: "brand", type: "text-prompt", data: {} },
    { id: "llm", type: "llm-chat", data: {} },
    { id: "va", type: "video-analysis", data: {} },
  ]
  const states = {
    trig: { status: "completed", startedAt: "2026-10-03T10:00:00Z", output: { text: "https://youtu.be/x" } },
    brand: { status: "completed", output: { text: "We sell matcha." } },
    llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z" },
    va: { status: "pending" },
  }

  it("takes the nodes that ran — never the trigger's message, never a pass-through", () => {
    expect(Object.keys(paintableStates(nodes, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false }))).toEqual(["llm"])
  })

  it("while the run is going, also the nodes it is about to run", () => {
    expect(Object.keys(paintableStates(nodes, states, { id: "r1", active: true })).sort()).toEqual(["llm", "va"])
  })

  it("never a node already showing this run, or one cleared after the run ended", () => {
    const marked = nodes.map((n) => (n.id === "llm" ? { ...n, data: { [RESULTS_RUN_ID_KEY]: "r1" } } : n))
    expect(paintableStates(marked, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false })).toEqual({})
    const cleared = nodes.map((n) => (n.id === "llm" ? { ...n, data: { resultsClearedAt: "2026-10-03T11:00:00Z" } } : n))
    expect(paintableStates(cleared, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false })).toEqual({})
  })

  it("a node showing an OLDER run takes the new one", () => {
    const older = nodes.map((n) => (n.id === "llm" ? { ...n, data: { [RESULTS_RUN_ID_KEY]: "r0" } } : n))
    expect(Object.keys(paintableStates(older, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false }))).toEqual(["llm"])
  })
})

describe("triggerNodesOf", () => {
  it("is the trigger nodes the run started from", () => {
    const nodes = [
      { id: "trig", type: "telegram-account-trigger", data: {} },
      { id: "other", type: "telegram-account-trigger", data: {} },
      { id: "llm", type: "llm-chat", data: {} },
    ]
    expect(triggerNodesOf(nodes, { trig: {}, llm: {} })).toEqual(["trig"])
  })
})

describe("review round 1", () => {
  const nodes = [
    { id: "llm", type: "llm-chat", data: { resultsClearedAt: "2026-10-03T09:00:00Z" } },
    { id: "va", type: "video-analysis", data: {} },
  ]

  it("a live follow paints a node cleared BEFORE the run: in progress, and once it ends", () => {
    const going = { llm: { status: "running", startedAt: "2026-10-03T10:00:01Z" } }
    expect(Object.keys(paintableStates(nodes, going, { id: "r1", active: true }))).toEqual(["llm"])
    const ended = { llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", completedAt: "2026-10-03T10:00:15Z" } }
    expect(Object.keys(paintableStates(nodes, ended, { id: "r1", active: true }))).toEqual(["llm"])
  })

  it("the clear rule reads the node's own end, not only the run's", () => {
    const cleared = [{ id: "llm", type: "llm-chat", data: { resultsClearedAt: "2026-10-03T10:00:20Z" } }]
    const ended = { llm: { status: "completed", startedAt: "2026-10-03T10:00:01Z", completedAt: "2026-10-03T10:00:15Z" } }
    expect(paintableStates(cleared, ended, { id: "r1", active: true })).toEqual({})
  })

  it("an ended run paints only nodes that ended: an orphaned 'running' node never paints", () => {
    const orphaned = { va: { status: "running", startedAt: "2026-10-03T10:00:01Z" } }
    expect(paintableStates(nodes, orphaned, { id: "r1", completedAt: "2026-10-03T10:30:00Z", active: false })).toEqual({})
  })

  it("a node that failed paints even if it never got to start", () => {
    const refused = { va: { status: "failed" } }
    expect(Object.keys(paintableStates(nodes, refused, { id: "r1", completedAt: "2026-10-03T10:00:16Z", active: false }))).toEqual(["va"])
  })
})

describe("endedRunToShow — by END time (the list is in start order)", () => {
  const t = (id: string, status: string, triggerType: string, createdAt: string, completedAt?: string): FollowRun => ({
    id,
    status,
    triggerType,
    createdAt,
    ...(completedAt ? { completedAt } : {}),
  })

  it("an editor run still going keeps the canvas", () => {
    const rows = [t("tg", "completed", "telegram_account", "2026-10-03T10:01:00Z", "2026-10-03T10:01:20Z"), t("m", "running", "manual", "2026-10-03T10:00:00Z")]
    expect(endedRunToShow(rows)).toBeNull()
  })

  it("an editor run that STARTED before the Telegram run but ENDED after it keeps the canvas", () => {
    const rows = [
      t("tg", "completed", "telegram_account", "2026-10-03T10:01:00Z", "2026-10-03T10:01:20Z"),
      t("m", "completed", "manual", "2026-10-03T10:00:00Z", "2026-10-03T10:02:00Z"),
    ]
    expect(endedRunToShow(rows)).toBeNull()
  })

  it("an editor run that ended before the Telegram run ended does not", () => {
    const rows = [
      t("tg", "completed", "telegram_account", "2026-10-03T10:01:00Z", "2026-10-03T10:01:20Z"),
      t("m", "completed", "manual", "2026-10-03T10:00:00Z", "2026-10-03T10:00:30Z"),
    ]
    expect(endedRunToShow(rows)?.id).toBe("tg")
  })
})

describe("activeFollowedIds", () => {
  it("is every Telegram run still going", () => {
    expect(activeFollowedIds([run("a", "running"), run("b", "pending"), run("c", "completed"), run("s", "running", "schedule")])).toEqual(["a", "b"])
  })
})

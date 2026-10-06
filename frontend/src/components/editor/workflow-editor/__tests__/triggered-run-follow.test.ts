/**
 * Which run the editor did not start the canvas follows or shows — a Telegram
 * message, an MCP client, the API live; a schedule or a webhook once ended —
 * and which of its node states it may paint: never over something the editor
 * ran since, never a trigger node's message, a pass-through node, a node
 * cleared after the run, a node already showing that run, or a node showing a
 * run that ended later.
 */
import { describe, it, expect } from "vitest"
import {
  RESULTS_RUN_ENDED_AT_KEY,
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

  it("is nothing for runs on other lanes: a schedule or a webhook is not followed live, nor the editor's own run", () => {
    expect(runToFollow([run("s", "running", "schedule"), run("w", "running", "webhook"), run("m", "running", "manual")], new Set())).toBeNull()
  })

  it("takes the bot trigger's lane too", () => {
    expect(runToFollow([run("b", "running", "telegram")], new Set())?.id).toBe("b")
  })

  it("follows a run an MCP client started: a person is waiting for it", () => {
    expect(runToFollow([run("mcp", "running", "mcp")], new Set())?.id).toBe("mcp")
  })

  it("never follows an API token's run: an integration can fire every minute, and its Stop is not the person's", () => {
    expect(runToFollow([run("api", "pending", "api")], new Set())).toBeNull()
    expect(runToFollow([run("api", "running", "api")], new Set())).toBeNull()
  })
})

describe("endedRunToShow", () => {
  it("is the run on a canvas lane that ended LAST, past runs on lanes the canvas leaves alone", () => {
    expect(
      endedRunToShow([
        run("app", "completed", "app_run", "2026-10-03T10:05:00Z"),
        run("t2", "completed", "telegram_account", "2026-10-03T10:02:00Z"),
        run("t1", "completed", "telegram_account", "2026-10-03T10:01:00Z"),
      ])?.id,
    ).toBe("t2")
    expect(endedRunToShow([run("t", "failed")])?.id).toBe("t")
    expect(endedRunToShow([run("t", "timed_out")])?.id).toBe("t")
  })

  it("shows a schedule's, a webhook's, an MCP client's or the API's run once it ended", () => {
    expect(endedRunToShow([run("s", "completed", "schedule")])?.id).toBe("s")
    expect(endedRunToShow([run("w", "failed", "webhook")])?.id).toBe("w")
    expect(endedRunToShow([run("mcp", "completed", "mcp")])?.id).toBe("mcp")
    expect(endedRunToShow([run("api", "completed", "api")])?.id).toBe("api")
  })

  it("is nothing when the editor ran something since: its own result is newer", () => {
    expect(endedRunToShow([run("m", "completed", "manual"), run("t", "completed")])).toBeNull()
    expect(endedRunToShow([run("n", "completed", "single-node"), run("t", "completed")])).toBeNull()
  })

  it("is nothing while a newer live-lane run is still going (that one is followed)", () => {
    expect(endedRunToShow([run("live", "running"), run("t", "completed")])).toBeNull()
    expect(endedRunToShow([run("mcp", "pending", "mcp"), run("t", "completed")])).toBeNull()
  })

  it("an ended API run is painted even while a newer API run is going (an integration is never followed)", () => {
    expect(
      endedRunToShow([
        run("a2", "running", "api"),
        run("a1", "completed", "api", "2026-10-03T10:01:00Z"),
      ])?.id,
    ).toBe("a1")
  })

  it("a run stopped on purpose is never painted; the one that ended before it still is", () => {
    expect(endedRunToShow([run("stopped", "cancelled")])).toBeNull()
    expect(endedRunToShow([run("stopped", "cancelled"), run("t", "completed")])?.id).toBe("t")
  })

  it("an ended schedule run is painted even while a newer schedule run is going (a schedule is never followed)", () => {
    expect(
      endedRunToShow([
        run("s2", "running", "schedule"),
        run("s1", "completed", "schedule", "2026-10-03T10:01:00Z"),
      ])?.id,
    ).toBe("s1")
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

  it("an ended run never paints over a node showing a run that ended LATER (a schedule fired since, or the editor ran)", () => {
    const newer = nodes.map((n) =>
      n.id === "llm" ? { ...n, data: { [RESULTS_RUN_ID_KEY]: "r9", [RESULTS_RUN_ENDED_AT_KEY]: "2026-10-03T10:05:00Z" } } : n,
    )
    expect(paintableStates(newer, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false })).toEqual({})
    // The node's own end decides when the state carries one.
    const ownEnd = { llm: { ...states.llm, completedAt: "2026-10-03T10:06:00Z" } }
    expect(Object.keys(paintableStates(newer, ownEnd, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false }))).toEqual(["llm"])
    // A live follow is the newest thing happening: it paints regardless.
    expect(Object.keys(paintableStates(newer, states, { id: "r1", active: true })).sort()).toEqual(["llm", "va"])
    // An unreadable time keeps the node paintable, like the clear rule.
    const garbled = nodes.map((n) => (n.id === "llm" ? { ...n, data: { [RESULTS_RUN_ENDED_AT_KEY]: "not a time" } } : n))
    expect(Object.keys(paintableStates(garbled, states, { id: "r1", completedAt: "2026-10-03T10:00:20Z", active: false }))).toEqual(["llm"])
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
  it("is every live-lane run still going — never a schedule or a webhook", () => {
    expect(
      activeFollowedIds([run("a", "running"), run("b", "pending"), run("c", "completed"), run("s", "running", "schedule"), run("m", "running", "mcp")]),
    ).toEqual(["a", "b", "m"])
  })
})

describe("a single-node job listed beside the runs (kind: job)", () => {
  const job = (id: string, status: string, triggerType: string, completedAt?: string): FollowRun => ({
    ...run(id, status, triggerType, completedAt),
    kind: "job",
  })

  it("is never followed, whatever lane it says — an MCP client's one-node job is not a run", () => {
    expect(runToFollow([job("j", "running", "mcp")], new Set())).toBeNull()
    expect(activeFollowedIds([job("j", "running", "mcp"), run("r", "running", "mcp")])).toEqual(["r"])
  })

  it("is never painted, and neither blocks nor outranks an ended run", () => {
    expect(endedRunToShow([job("j", "completed", "mcp")])).toBeNull()
    expect(
      endedRunToShow([
        job("j", "completed", "mcp", "2026-10-03T10:05:00Z"),
        run("t", "completed", "telegram_account", "2026-10-03T10:01:00Z"),
      ])?.id,
    ).toBe("t")
    expect(endedRunToShow([job("j", "running", "mcp"), run("t", "completed")])?.id).toBe("t")
  })

  it("a row that says it is a run behaves as before", () => {
    expect(runToFollow([{ ...run("r", "running", "mcp"), kind: "execution" }], new Set())?.id).toBe("r")
  })
})

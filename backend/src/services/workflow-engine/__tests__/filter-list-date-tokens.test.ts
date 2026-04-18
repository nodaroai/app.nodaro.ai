import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { executeFilterList, type FilterListCondition } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

/**
 * Bug addressed: the Filter List value field for date/time comparisons used
 * to require users to type `{{trigger.last_triggered_at}}` by hand. The
 * smart picker in the frontend now emits compact relative-window tokens
 * (`{{last_N_hours:3}}`, `{{last_N_days:1}}`, `{{last_N_weeks:2}}`) that
 * the backend must resolve to an ISO timestamp at execution time.
 */
describe("executeFilterList — relative-window date tokens", () => {
  // Freeze time so windowed comparisons are deterministic across runs.
  const NOW_ISO = "2026-04-18T22:00:00.000Z"
  const NOW_MS = new Date(NOW_ISO).getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setupDateFilter(items: unknown[], condition: FilterListCondition) {
    const src = makeNode("s", "web-scrape", {})
    const filter = makeNode("f", "filter-list", {
      conditions: [condition],
      conditionLogic: "AND",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "s", target: "f", sourceHandle: "json", targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: items } },
    }
    return { filter, edges, nodes: [src, filter], states }
  }

  it("{{last_N_hours:3}} resolves to NOW - 3h and filters items whose created_at is within the window", () => {
    // Within last 3h: 1h ago, 2h ago. Older than 3h: 4h ago, 10h ago.
    const items = [
      { id: "a", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
      { id: "b", created_at: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString() },
      { id: "c", created_at: new Date(NOW_MS - 4 * 60 * 60 * 1000).toISOString() },
      { id: "d", created_at: new Date(NOW_MS - 10 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: ">",
      value: "{{last_N_hours:3}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["a", "b"])
  })

  it("{{last_N_days:1}} — anything from the last 24h passes >", () => {
    const items = [
      { id: "a", published_at: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString() }, // 5h ago
      { id: "b", published_at: new Date(NOW_MS - 23 * 60 * 60 * 1000).toISOString() }, // 23h ago
      { id: "c", published_at: new Date(NOW_MS - 25 * 60 * 60 * 1000).toISOString() }, // 25h ago
      { id: "d", published_at: new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString() }, // 2d ago
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "published_at",
      operator: ">",
      value: "{{last_N_days:1}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["a", "b"])
  })

  it("{{last_N_weeks:2}} — two-week window, using epoch-ms numeric timestamps", () => {
    // Mix numeric (epoch ms) and ISO fields to confirm numeric-first compare
    // still works through the token substitution pipeline.
    const items = [
      { id: "recent", updated_at: NOW_MS - 3 * 24 * 60 * 60 * 1000 }, // 3 days ago
      { id: "edge", updated_at: NOW_MS - 13 * 24 * 60 * 60 * 1000 }, // 13 days ago
      { id: "stale", updated_at: NOW_MS - 20 * 24 * 60 * 60 * 1000 }, // 20 days ago
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "updated_at",
      operator: ">",
      value: "{{last_N_weeks:2}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["recent", "edge"])
  })

  it(">= is boundary-inclusive against a relative-window token", () => {
    // Edge case: item exactly at NOW - 1h should pass `>= {{last_N_hours:1}}`.
    const items = [
      { id: "edge", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
      { id: "past", created_at: new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: ">=",
      value: "{{last_N_hours:1}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["edge"])
  })

  it("< operator with relative token keeps items older than the window (inverse of >)", () => {
    const items = [
      { id: "recent", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
      { id: "old", created_at: new Date(NOW_MS - 5 * 60 * 60 * 1000).toISOString() },
      { id: "older", created_at: new Date(NOW_MS - 10 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: "<",
      value: "{{last_N_hours:3}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["old", "older"])
  })

  it("existing {{trigger.last_triggered_at}} still resolves (backwards compatible)", () => {
    const lastRun = new Date(NOW_MS - 4 * 60 * 60 * 1000).toISOString()
    const items = [
      { id: "a", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
      { id: "b", created_at: new Date(NOW_MS - 6 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: ">",
      value: "{{trigger.last_triggered_at}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states, { last_triggered_at: lastRun })
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["a"])
  })

  it("existing {{now}} still resolves (backwards compatible)", () => {
    const items = [
      { id: "future", created_at: new Date(NOW_MS + 1 * 60 * 60 * 1000).toISOString() }, // 1h in future
      { id: "past", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: ">",
      value: "{{now}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["future"])
  })

  it("malformed relative token resolves to empty string (mirrors unknown-variable handling)", () => {
    // Not a valid last_N_* pattern — falls through the resolver and becomes "".
    // Empty-string compare against a number yields locale fallback → all items
    // pass `>`. This documents the current unknown-token behaviour.
    const items = [{ id: "a", v: 42 }]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "v",
      operator: ">",
      value: "{{last_N_fortnights:2}}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["a"])
  })

  it("accepts whitespace inside braces (e.g. `{{ last_N_hours:3 }}`)", () => {
    const items = [
      { id: "a", created_at: new Date(NOW_MS - 1 * 60 * 60 * 1000).toISOString() },
      { id: "b", created_at: new Date(NOW_MS - 10 * 60 * 60 * 1000).toISOString() },
    ]
    const { filter, edges, nodes, states } = setupDateFilter(items, {
      id: "c1",
      field: "created_at",
      operator: ">",
      value: "{{  last_N_hours:3  }}",
      valueType: "variable",
    })

    const result = executeFilterList(filter, edges, nodes, states)
    const kept = (result.listResults ?? []).map((s) => JSON.parse(s).id)
    expect(kept).toEqual(["a"])
  })
})

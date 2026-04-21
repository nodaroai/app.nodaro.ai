import { describe, it, expect } from "vitest"
import { executeRouter, type FilterListCondition } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

type GroupSpec = {
  conditions: Array<Partial<FilterListCondition> & { operator: FilterListCondition["operator"] }>
  conditionLogic?: "AND" | "OR"
  routeIds: string[]
}

/** Build a router wired to a single upstream `extract-field` source whose
 *  cached state emits `text: upstreamText`. The router has `routeCount` routes
 *  with stable ids `r1`, `r2`, ... so tests can reference them by name. */
function setupConditional(
  upstreamText: string,
  routeCount: number,
  groups: GroupSpec[],
  triggerData?: Record<string, unknown>,
) {
  const routes = Array.from({ length: routeCount }, (_, i) => ({
    id: `r${i + 1}`,
    name: `Route ${String.fromCharCode(65 + i)}`,
    active: false,
  }))
  const conditionGroups = groups.map((g, gi) => ({
    id: `g${gi + 1}`,
    conditionLogic: g.conditionLogic ?? "AND",
    routeIds: g.routeIds,
    conditions: g.conditions.map((c, ci) => ({
      id: `${gi + 1}-${ci + 1}`,
      field: c.field ?? "",
      operator: c.operator,
      value: c.value ?? "",
      valueType: c.valueType ?? "static",
    })),
  }))
  const router = makeNode("router", "router", {
    mode: "conditional",
    routes,
    conditionGroups,
  })
  const source = makeNode("src", "extract-field", {})
  const edges: SimpleEdge[] = [
    { id: "e1", source: "src", target: "router", sourceHandle: "text", targetHandle: "in" } as SimpleEdge,
  ]
  const states: Record<string, NodeExecutionState> = {
    src: { status: "completed", output: { extractedText: upstreamText } },
  }
  return executeRouter(router, edges, [source, router], states, triggerData)
}

describe("executeRouter — conditional mode", () => {
  it("single AND group with both conditions matching activates its routes", () => {
    const out = setupConditional(
      JSON.stringify({ url: "https://example.com/news", label: "news today" }),
      3,
      [
        {
          conditionLogic: "AND",
          conditions: [
            { field: "url", operator: "starts_with", value: "http" },
            { field: "label", operator: "contains", value: "news" },
          ],
          routeIds: ["r1", "r3"],
        },
      ],
    )
    expect(out.activeRoutes).toEqual(["r1", "r3"])
    expect(out.routeOutputs?.r1).toBeDefined()
    expect(out.routeOutputs?.r2).toBeUndefined()
    expect(out.routeOutputs?.r3).toBeDefined()
    expect(out.text).toBe("routed")
  })

  it("OR group with any condition matching activates its routes", () => {
    const out = setupConditional(
      JSON.stringify({ label: "sports highlights" }),
      2,
      [
        {
          conditionLogic: "OR",
          conditions: [
            { field: "label", operator: "contains", value: "news" },
            { field: "label", operator: "contains", value: "sports" },
          ],
          routeIds: ["r2"],
        },
      ],
    )
    expect(out.activeRoutes).toEqual(["r2"])
  })

  it("unions routeIds across multiple matching groups (deduped, visual order preserved)", () => {
    const out = setupConditional(
      JSON.stringify({ url: "https://news.example.com", label: "news" }),
      3,
      [
        {
          conditions: [{ field: "url", operator: "starts_with", value: "http" }],
          routeIds: ["r1"],
        },
        {
          conditions: [{ field: "label", operator: "contains", value: "news" }],
          routeIds: ["r1", "r2"],
        },
      ],
    )
    // r1 is activated by both groups — must appear once.
    expect(out.activeRoutes).toEqual(["r1", "r2"])
  })

  it("no group matches => zero active routes, all routeOutputs undefined, flow stops", () => {
    const out = setupConditional(
      JSON.stringify({ label: "weather" }),
      3,
      [
        {
          conditions: [{ field: "label", operator: "contains", value: "news" }],
          routeIds: ["r1"],
        },
      ],
    )
    expect(out.activeRoutes).toEqual([])
    expect(out.text).toBeUndefined()
    expect(out.routeOutputs?.r1).toBeUndefined()
    expect(out.routeOutputs?.r2).toBeUndefined()
    expect(out.routeOutputs?.r3).toBeUndefined()
  })

  it("empty conditionGroups => zero active (baseline for fresh-created node)", () => {
    const out = setupConditional(JSON.stringify({ x: 1 }), 2, [])
    expect(out.activeRoutes).toEqual([])
    expect(out.text).toBeUndefined()
  })

  it("group with empty conditions still activates (empty AND is a tautology)", () => {
    const out = setupConditional(
      JSON.stringify({ anything: 1 }),
      2,
      [{ conditions: [], routeIds: ["r1"] }],
    )
    expect(out.activeRoutes).toEqual(["r1"])
  })

  it("group with empty routeIds is skipped even when conditions match", () => {
    const out = setupConditional(
      JSON.stringify({ label: "match" }),
      2,
      [{ conditions: [{ field: "label", operator: "contains", value: "match" }], routeIds: [] }],
    )
    expect(out.activeRoutes).toEqual([])
  })

  it("raw string input + empty field path uses whole-item comparison", () => {
    const out = setupConditional(
      "https://example.com",
      2,
      [{ conditions: [{ operator: "starts_with", value: "https" }], routeIds: ["r2"] }],
    )
    expect(out.activeRoutes).toEqual(["r2"])
  })

  it("resolves trigger.* tokens from triggerData when passed", () => {
    const out = setupConditional(
      JSON.stringify({ created_at: "2026-03-01T00:00:00Z" }),
      2,
      [
        {
          conditions: [
            { field: "created_at", operator: ">", value: "{{trigger.last_triggered_at}}", valueType: "variable" },
          ],
          routeIds: ["r1"],
        },
      ],
      { last_triggered_at: "2026-02-01T00:00:00Z" },
    )
    expect(out.activeRoutes).toEqual(["r1"])
  })
})

describe("executeRouter — mode regression guards", () => {
  function makeRadio(activeIdx: number) {
    const routes = [
      { id: "r1", name: "A", active: activeIdx === 0 },
      { id: "r2", name: "B", active: activeIdx === 1 },
      { id: "r3", name: "C", active: activeIdx === 2 },
    ]
    const router = makeNode("router", "router", {
      mode: "radio",
      routes,
      // conditionGroups set but ignored — regression guard.
      conditionGroups: [{ id: "g1", conditions: [], conditionLogic: "AND", routeIds: ["r2", "r3"] }],
    })
    const source = makeNode("src", "extract-field", {})
    const edges: SimpleEdge[] = [
      { id: "e1", source: "src", target: "router", sourceHandle: "text", targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      src: { status: "completed", output: { extractedText: "hello" } },
    }
    return executeRouter(router, edges, [source, router], states)
  }

  it("radio mode ignores conditionGroups — only manual active flag counts", () => {
    const out = makeRadio(0)
    expect(out.activeRoutes).toEqual(["r1"])
    expect(out.routeOutputs?.r1).toBe("hello")
    expect(out.routeOutputs?.r2).toBeUndefined()
    expect(out.routeOutputs?.r3).toBeUndefined()
  })

  it("checkbox mode ignores conditionGroups too", () => {
    const routes = [
      { id: "r1", name: "A", active: true },
      { id: "r2", name: "B", active: true },
    ]
    const router = makeNode("router", "router", {
      mode: "checkbox",
      routes,
      conditionGroups: [{ id: "g1", conditions: [], conditionLogic: "AND", routeIds: [] }],
    })
    const source = makeNode("src", "extract-field", {})
    const edges: SimpleEdge[] = [
      { id: "e1", source: "src", target: "router", sourceHandle: "text", targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      src: { status: "completed", output: { extractedText: "x" } },
    }
    const out = executeRouter(router, edges, [source, router], states)
    expect(out.activeRoutes).toEqual(["r1", "r2"])
  })
})

describe("executeRouter — passthrough value behavior", () => {
  it("routeOutputs contains input value for active routes", () => {
    const out = setupConditional(
      "https://example.com",
      2,
      [{ conditions: [{ operator: "starts_with", value: "https" }], routeIds: ["r1"] }],
    )
    expect(out.routeOutputs?.r1).toBe("https://example.com")
  })

  it("missing upstream falls back to 'gate' for active routes", () => {
    const routes = [{ id: "r1", name: "A", active: false }]
    const router = makeNode("router", "router", {
      mode: "conditional",
      routes,
      conditionGroups: [{ id: "g1", conditions: [], conditionLogic: "AND", routeIds: ["r1"] }],
    })
    // No upstream at all.
    const out = executeRouter(router, [], [router], {})
    expect(out.activeRoutes).toEqual(["r1"])
    expect(out.routeOutputs?.r1).toBe("gate")
  })
})

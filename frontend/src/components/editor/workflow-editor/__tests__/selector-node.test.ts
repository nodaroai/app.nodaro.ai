/**
 * Frontend integration tests for the selector node (Task 20 of selector-node plan).
 * Verifies: (1) `runSelector` item-mode picked/rest, (2) random seed determinism,
 * (3) `extractNodeOutput` routes picked/rest by sourceHandle, (4) `resolveNodeInputs`
 * wires the rest channel into a downstream consumer. Mirrors the resolver-style
 * tests in `node-input-resolver.test.ts` rather than invoking `executeNode`
 * directly — the selector branch reads from the Zustand store via several
 * internal helpers, so full executeNode coverage would require heavy mocking
 * that adds no signal over the building-block tests.
 */
import { describe, it, expect, vi } from "vitest"
import { runSelector } from "@nodaro/shared"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { extractNodeOutput } from "../execution-graph"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowNode } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data },
  } as unknown as WorkflowNode
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string } {
  return {
    id: `${source}->${target}->${sourceHandle ?? "_"}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

// ---------------------------------------------------------------------------
// 1. Item mode: runSelector returns picked + rest
// ---------------------------------------------------------------------------

describe("selector node — runSelector item mode", () => {
  it("picks index N and emits the others as rest", () => {
    const items = ["a", "b", "c", "d"]
    // itemIndex "2" is 1-based → second item ("b")
    const { picked, rest } = runSelector(items, { mode: "item", itemIndex: "2" })
    expect(picked).toEqual(["b"])
    expect(rest).toEqual(["a", "c", "d"])
  })

  it("picked ∪ rest preserves all original items (no duplicates, no loss)", () => {
    const items = ["one", "two", "three", "four", "five"]
    const { picked, rest } = runSelector(items, { mode: "item", itemIndex: "3" })
    expect([...picked, ...rest].sort()).toEqual([...items].sort())
    expect(picked.length + rest.length).toBe(items.length)
  })
})

// ---------------------------------------------------------------------------
// 2. Random mode determinism
// ---------------------------------------------------------------------------

describe("selector node — random mode determinism", () => {
  it("same seed produces identical picked/rest across two runs", () => {
    const items = ["alpha", "beta", "gamma", "delta", "epsilon"]
    const config = { mode: "random" as const, seed: "fixed-seed-42", randomCount: 2 }

    const run1 = runSelector(items, config)
    const run2 = runSelector(items, config)

    expect(run1.picked).toEqual(run2.picked)
    expect(run1.rest).toEqual(run2.rest)
    expect(run1.picked.length).toBe(2)
    expect(run1.rest.length).toBe(3)
  })

  it("different seeds produce (usually) different picks", () => {
    const items = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]
    const pickA = runSelector(items, { mode: "random", seed: "seed-A", randomCount: 3 }).picked
    const pickB = runSelector(items, { mode: "random", seed: "seed-B", randomCount: 3 }).picked
    // With 8 items × 3 picks and two different seeds, identical picks are extremely improbable
    // for the chosen seeds; assert they differ in at least one position.
    expect(pickA).not.toEqual(pickB)
  })
})

// ---------------------------------------------------------------------------
// 3. extractNodeOutput routes picked vs rest by sourceHandle
// ---------------------------------------------------------------------------

describe("selector node — extractNodeOutput handle routing", () => {
  it("returns first picked item when sourceHandle is 'picked'", () => {
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "2" },
      __pickedResults: ["b"],
      __restResults: ["a", "c", "d"],
      pickedResults: ["b"],
      restResults: ["a", "c", "d"],
    })
    expect(extractNodeOutput(sel, "picked")).toBe("b")
  })

  it("returns first rest item when sourceHandle is 'rest'", () => {
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "2" },
      __pickedResults: ["b"],
      __restResults: ["a", "c", "d"],
    })
    expect(extractNodeOutput(sel, "rest")).toBe("a")
  })

  it("defaults to picked when sourceHandle is undefined or unknown", () => {
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "1" },
      __pickedResults: ["picked-first"],
      __restResults: ["rest-first", "rest-second"],
    })
    expect(extractNodeOutput(sel, undefined)).toBe("picked-first")
  })

  it("falls back to non-mirror keys (pickedResults / restResults) when runtime mirrors are absent", () => {
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "1" },
      pickedResults: ["snap-pick"],
      restResults: ["snap-rest-1", "snap-rest-2"],
    })
    expect(extractNodeOutput(sel, "picked")).toBe("snap-pick")
    expect(extractNodeOutput(sel, "rest")).toBe("snap-rest-1")
  })
})

// ---------------------------------------------------------------------------
// 4. resolveNodeInputs: downstream consumer on the 'rest' handle gets rest items
// ---------------------------------------------------------------------------

describe("selector node — resolveNodeInputs rest handle routing", () => {
  it("routes the rest channel to a downstream consumer wired via sourceHandle='rest'", () => {
    // Setup: selector has emitted picked=["b"], rest=["a","c","d"].
    // Downstream generate-image is wired to the selector's 'rest' handle and
    // should see "a" as its prompt (first item of the rest list — selector's
    // primary scalar output for that channel).
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "2" },
      __pickedResults: ["b"],
      __restResults: ["a", "c", "d"],
    })
    const consumer = makeNode("gen1", "generate-image")
    const edges = [makeEdge("sel1", "gen1", "rest")]

    const inputs = resolveNodeInputs(consumer, [sel, consumer], edges)
    // Resolver fans the upstream selector's "rest" list into prompt (first item)
    // — same behavior as a list source feeding generate-image.
    expect(inputs.prompt).toBe("a")
  })

  it("routes the picked channel to a downstream consumer wired via sourceHandle='picked'", () => {
    const sel = makeNode("sel1", "selector", {
      config: { mode: "item", itemIndex: "2" },
      __pickedResults: ["b"],
      __restResults: ["a", "c", "d"],
    })
    const consumer = makeNode("gen1", "generate-image")
    const edges = [makeEdge("sel1", "gen1", "picked")]

    const inputs = resolveNodeInputs(consumer, [sel, consumer], edges)
    expect(inputs.prompt).toBe("b")
  })
})

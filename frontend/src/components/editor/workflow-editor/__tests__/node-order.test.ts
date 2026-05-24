/**
 * Regression test for the group-node "totally broken" bug (PR #2692 follow-up).
 *
 * React Flow v12 requires a parent node to appear BEFORE its children in the
 * nodes array. When a group is drawn around existing nodes, the group lands
 * AFTER its children in the store array, and nothing reordered it — so
 * `adoptUserNodes` warned "Parent node not found" and rendered each child at
 * its LOCAL coords interpreted as absolute (teleport to ~origin), with no
 * parent/child link (group couldn't move them).
 *
 * `orderNodesParentFirst` (group-coords.ts) is the fix, applied at the single
 * point the array enters React Flow (workflow-canvas.tsx) and on load
 * (use-workflow-store.ts loadWorkflow). These tests pin the pure invariant AND
 * exercise React Flow's REAL ordering engine to prove the bug + fix.
 *
 * NOTE on coverage: this class of bug was invisible to the existing group
 * tests because they mock `@xyflow/react` and use already-parent-first
 * fixtures. This file imports the real `@xyflow/system` engine instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
// adoptUserNodes drives React Flow's real ordering engine. It lives in
// @xyflow/system (React Flow's internal package), declared as an explicit
// devDependency pinned to the same 0.0.76 that @xyflow/react resolves — so the
// import is stable under strict/non-hoisted installs instead of relying on
// transitive hoisting.
import { adoptUserNodes } from "@xyflow/system"
import { orderNodesParentFirst } from "../group-coords"

describe("orderNodesParentFirst", () => {
  it("moves a parent (group) ahead of a child stored before it", () => {
    const ordered = orderNodesParentFirst([
      { id: "child", parentId: "grp" },
      { id: "grp" },
    ])
    expect(ordered.map((n) => n.id)).toEqual(["grp", "child"])
  })

  it("keeps all parents before all children while preserving relative order", () => {
    const ordered = orderNodesParentFirst([
      { id: "c1", parentId: "g1" },
      { id: "g1" },
      { id: "c2", parentId: "g1" },
      { id: "g2" },
      { id: "c3", parentId: "g2" },
    ])
    expect(ordered.map((n) => n.id)).toEqual(["g1", "g2", "c1", "c2", "c3"])
    // every parent precedes each of its children
    for (const child of ordered.filter((n) => n.parentId)) {
      const pIdx = ordered.findIndex((n) => n.id === child.parentId)
      const cIdx = ordered.findIndex((n) => n.id === child.id)
      expect(pIdx).toBeLessThan(cIdx)
    }
  })

  it("returns the same array reference when there are no children (no re-render churn)", () => {
    const input = [{ id: "a" }, { id: "b" }]
    expect(orderNodesParentFirst(input)).toBe(input)
  })

  it("is idempotent on already-ordered input", () => {
    const once = orderNodesParentFirst([{ id: "g" }, { id: "c", parentId: "g" }])
    const twice = orderNodesParentFirst(once)
    expect(twice.map((n) => n.id)).toEqual(["g", "c"])
  })
})

describe("group ordering — real React Flow adoptUserNodes engine", () => {
  afterEach(() => vi.restoreAllMocks())

  // group at world (800,400); child stored at group-LOCAL (30,50).
  // Correct render: child absolute = (830,450). Broken render: child stays at
  // its local coords (30,50) — teleported to ~origin.
  const group = { id: "grp", type: "group", position: { x: 800, y: 400 }, data: {} }
  const child = { id: "c", type: "text-prompt", position: { x: 30, y: 50 }, data: {}, parentId: "grp" }

  function adopt(nodes: unknown[]) {
    const nodeLookup = new Map()
    const parentLookup = new Map()
    // structuredClone so each run starts from fresh, un-mutated node objects
    adoptUserNodes(structuredClone(nodes) as never, nodeLookup, parentLookup, {})
    return nodeLookup
  }

  it("child-before-parent (the bug): warns and teleports child to its local coords", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const lookup = adopt([child, group]) // broken store order
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Parent node grp not found"),
    )
    expect(lookup.get("c").internals.positionAbsolute).toEqual({ x: 30, y: 50 })
  })

  it("orderNodesParentFirst fixes it: no warning, child positioned relative to group", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const lookup = adopt(orderNodesParentFirst([child, group]))
    // Scope to the ordering warning specifically — an unrelated adoptUserNodes
    // warning in a future @xyflow version must not red this test spuriously.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Parent node"))
    expect(lookup.get("c").internals.positionAbsolute).toEqual({ x: 830, y: 450 })
  })
})

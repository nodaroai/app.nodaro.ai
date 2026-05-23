/**
 * Task J1: Frontend integration — Group/Collect end-to-end through the store
 *
 * Verifies that:
 *   1. A Group with 3 text-prompt children exposes a 3-item array on out-text
 *      that a downstream Loop can consume.
 *   2. A mixed-type Group (text + image) exposes the correct typed arrays
 *      on out-text and out-image.
 *   3. A Collect node aggregates upstreams by data.order with per-type buckets.
 *
 * These tests exercise loadWorkflow → store state → extractNodeOutputAsList,
 * which is the same path the Run-from-here executor uses.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import { extractNodeOutputAsList } from "../node-input-resolver";

beforeEach(() => {
  useWorkflowStore.getState().loadWorkflow("t", "Test", [], []);
});

describe("Group + Loop integration", () => {
  it("3 text-prompt children in a Group feed a 3-item array to a Loop downstream", () => {
    useWorkflowStore.getState().loadWorkflow("wf", "Test",
      [
        { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" }, measured: { width: 400, height: 300 } },
        { id: "t1", type: "text-prompt", position: { x: 10, y: 30 }, data: { text: "alpha" }, parentId: "g" },
        { id: "t2", type: "text-prompt", position: { x: 10, y: 80 }, data: { text: "beta" }, parentId: "g" },
        { id: "t3", type: "text-prompt", position: { x: 10, y: 130 }, data: { text: "gamma" }, parentId: "g" },
        { id: "lp", type: "loop", position: { x: 500, y: 0 }, data: { rows: [], columns: [{ handleId: "out" }] } },
      ] as never[],
      [
        { id: "e1", source: "g", sourceHandle: "out-text", target: "lp", targetHandle: "in" } as never,
      ],
    );
    const group = useWorkflowStore.getState().nodes.find((n) => n.id === "g")!;
    const items = extractNodeOutputAsList(group as never, "out-text");
    expect(items).toEqual(["alpha", "beta", "gamma"]);
  });

  it("Group + 1 text + 1 generate-image exposes 2 typed outputs", () => {
    useWorkflowStore.getState().loadWorkflow("wf", "Test",
      [
        { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
        { id: "tp", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "hello" }, parentId: "g" },
        { id: "img", type: "generate-image", position: { x: 0, y: 50 }, data: { generatedResults: [{ url: "https://r2/x.png" }], activeResultIndex: 0 }, parentId: "g" },
      ] as never[],
      [],
    );
    const group = useWorkflowStore.getState().nodes.find((n) => n.id === "g")!;
    expect(extractNodeOutputAsList(group as never, "out-text")).toEqual(["hello"]);
    expect(extractNodeOutputAsList(group as never, "out-image")).toEqual(["https://r2/x.png"]);
  });
});

describe("Collect integration", () => {
  it("3 mixed-type inputs to Collect produce per-type buckets", () => {
    useWorkflowStore.getState().loadWorkflow("wf", "Test",
      [
        { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { order: ["t1", "t2", "img1"] } },
        { id: "t1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "one" } },
        { id: "t2", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "two" } },
        { id: "img1", type: "generate-image", position: { x: 0, y: 0 }, data: { generatedResults: [{ url: "https://r2/i.png" }], activeResultIndex: 0 } },
      ] as never[],
      [
        { id: "e1", source: "t1", target: "c", targetHandle: "in" },
        { id: "e2", source: "t2", target: "c", targetHandle: "in" },
        { id: "e3", source: "img1", target: "c", targetHandle: "in" },
      ] as never[],
    );
    const c = useWorkflowStore.getState().nodes.find((n) => n.id === "c")!;
    expect(extractNodeOutputAsList(c as never, "out-text")).toEqual(["one", "two"]);
    expect(extractNodeOutputAsList(c as never, "out-image")).toEqual(["https://r2/i.png"]);
  });
});

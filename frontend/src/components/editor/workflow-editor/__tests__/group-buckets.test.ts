import { describe, expect, it, beforeEach } from "vitest";
import { useWorkflowStore } from "@/hooks/use-workflow-store";
import {
  computeGroupBuckets,
  computeCollectBuckets,
  buildExecutionLevels,
} from "../execution-graph";
import { extractNodeOutputAsList } from "../node-input-resolver";

beforeEach(() => {
  useWorkflowStore.getState().loadWorkflow("t", "Test", [], []);
});

describe("computeGroupBuckets", () => {
  it("returns empty buckets for group with no children", () => {
    const group = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } };
    expect(computeGroupBuckets(group as never, [group as never])).toEqual({
      text: [], image: [], video: [], audio: [],
    });
  });

  it("buckets text-prompt + generate-image children by Y position", () => {
    const group = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } };
    const tp1 = { id: "t1", type: "text-prompt", position: { x: 10, y: 20 }, data: { text: "first" }, parentId: "g" };
    const tp2 = { id: "t2", type: "text-prompt", position: { x: 10, y: 50 }, data: { text: "second" }, parentId: "g" };
    // extractNodeOutput reads results[activeResultIndex]?.url, so test data
    // must match the GeneratedResult shape ({ url }) and use activeResultIndex.
    const img = {
      id: "i1",
      type: "generate-image",
      position: { x: 10, y: 35 },
      data: { generatedResults: [{ url: "https://r2/img.png" }], activeResultIndex: 0 },
      parentId: "g",
    };
    const buckets = computeGroupBuckets(group as never, [group, tp1, tp2, img] as never[]);
    expect(buckets.text).toEqual(["first", "second"]);
    expect(buckets.image).toEqual(["https://r2/img.png"]);
  });

  it("skips multi-output children (List, returning 'data' from getOutputType)", () => {
    const group = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } };
    const list = { id: "l", type: "list", position: { x: 10, y: 20 }, data: { columns: [{ handleId: "col_0" }], rows: [["a"], ["b"]] }, parentId: "g" };
    expect(computeGroupBuckets(group as never, [group, list] as never[]).text).toEqual([]);
  });

  it("skips parameter pickers (tone, framing — they return 'data' from getOutputType)", () => {
    const group = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } };
    const tone = { id: "t", type: "tone", position: { x: 10, y: 20 }, data: { tone: "warm" }, parentId: "g" };
    expect(computeGroupBuckets(group as never, [group, tone] as never[]).text).toEqual([]);
  });
});

describe("computeCollectBuckets", () => {
  it("returns empty buckets for collect with no connections", () => {
    const c = { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { order: [] } };
    expect(computeCollectBuckets(c as never, [c as never], [])).toEqual({
      text: [], image: [], video: [], audio: [],
    });
  });

  it("sorts inputs by data.order", () => {
    const c = { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { order: ["t2", "t1"] } };
    const t1 = { id: "t1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "one" } };
    const t2 = { id: "t2", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "two" } };
    const edges = [
      { id: "e1", source: "t1", target: "c", targetHandle: "in" },
      { id: "e2", source: "t2", target: "c", targetHandle: "in" },
    ];
    expect(computeCollectBuckets(c as never, [c, t1, t2] as never[], edges as never[]).text).toEqual([
      "two", "one",
    ]);
  });
});

describe("extractNodeOutputAsList — group/collect", () => {
  it("returns full text bucket for group with two text-prompt children", () => {
    useWorkflowStore.getState().loadWorkflow("t", "Test",
      [
        { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
        { id: "t1", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "a" }, parentId: "g" },
        { id: "t2", type: "text-prompt", position: { x: 0, y: 20 }, data: { text: "b" }, parentId: "g" },
      ] as never[],
      [],
    );
    const group = useWorkflowStore.getState().nodes.find((n) => n.id === "g")!;
    expect(extractNodeOutputAsList(group as never, "out-text")).toEqual(["a", "b"]);
  });

  it("returns undefined when sourceHandle missing on a group/collect call", () => {
    useWorkflowStore.getState().loadWorkflow("t", "Test", [], []);
    const group = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } };
    expect(extractNodeOutputAsList(group as never)).toBeUndefined();
  });

  it("returns full text bucket for collect with two upstream text-prompts", () => {
    useWorkflowStore.getState().loadWorkflow("t", "Test",
      [
        { id: "c", type: "collect", position: { x: 0, y: 0 }, data: { order: ["t1", "t2"] } },
        { id: "t1", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "one" } },
        { id: "t2", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "two" } },
      ] as never[],
      [
        { id: "e1", source: "t1", target: "c", targetHandle: "in" },
        { id: "e2", source: "t2", target: "c", targetHandle: "in" },
      ] as never[],
    );
    const collect = useWorkflowStore.getState().nodes.find((n) => n.id === "c")!;
    expect(extractNodeOutputAsList(collect as never, "out-text")).toEqual(["one", "two"]);
  });
});

describe("resolveNodeInputs with group upstream", () => {
  it("a Loop downstream of a Group receives the full text-array via extractNodeOutputAsList", () => {
    useWorkflowStore.getState().loadWorkflow("t", "Test",
      [
        { id: "g", type: "group", position: { x: 0, y: 0 }, data: { label: "G" } },
        { id: "t1", type: "text-prompt", position: { x: 0, y: 10 }, data: { text: "a" }, parentId: "g" },
        { id: "t2", type: "text-prompt", position: { x: 0, y: 20 }, data: { text: "b" }, parentId: "g" },
      ] as never[],
      [],
    );
    const upstreamGroup = useWorkflowStore.getState().nodes.find((n) => n.id === "g")!;
    expect(extractNodeOutputAsList(upstreamGroup as never, "out-text")).toEqual(["a", "b"]);
  });
});

describe("buildExecutionLevels — implicit child→group edge", () => {
  it("orders children before the group node", () => {
    const nodes = [
      { id: "g", type: "group", position: { x: 0, y: 0 }, data: {} },
      { id: "c1", type: "text-prompt", position: { x: 0, y: 10 }, data: {}, parentId: "g" },
      { id: "c2", type: "text-prompt", position: { x: 0, y: 20 }, data: {}, parentId: "g" },
    ] as never[];
    const levels = buildExecutionLevels(nodes, []);
    const flatten = levels.flat().map((n: { id: string }) => n.id);
    expect(flatten.indexOf("c1")).toBeLessThan(flatten.indexOf("g"));
    expect(flatten.indexOf("c2")).toBeLessThan(flatten.indexOf("g"));
  });

  it("preserves topology when group has explicit upstream edges too", () => {
    const nodes = [
      { id: "x", type: "text-prompt", position: { x: 0, y: 0 }, data: {} },
      { id: "g", type: "group", position: { x: 100, y: 0 }, data: {} },
      { id: "c1", type: "text-prompt", position: { x: 110, y: 10 }, data: {}, parentId: "g" },
    ] as never[];
    const edges = [
      { id: "e1", source: "x", target: "g" },
    ] as never[];
    const levels = buildExecutionLevels(nodes, edges);
    const flatten = levels.flat().map((n: { id: string }) => n.id);
    expect(flatten.indexOf("c1")).toBeLessThan(flatten.indexOf("g"));
    expect(flatten.indexOf("x")).toBeLessThan(flatten.indexOf("g"));
  });
});

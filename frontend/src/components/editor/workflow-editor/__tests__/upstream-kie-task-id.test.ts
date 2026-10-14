// @vitest-environment node
import { describe, it, expect } from "vitest"
import { resolveUpstreamKieTaskId } from "../upstream-kie-task-id"

const nodes = [
  { id: "draft", data: { kieTaskId: "task-draft" } },
  { id: "other", data: {} },
  { id: "hd", data: {} },
]

describe("resolveUpstreamKieTaskId", () => {
  it("the node's own task id wins", () => {
    expect(resolveUpstreamKieTaskId("hd", { kieTaskId: "own" }, nodes, [{ source: "draft", target: "hd" }])).toBe("own")
  })

  it("else the first upstream node carrying one", () => {
    const edges = [
      { source: "other", target: "hd" },
      { source: "draft", target: "hd" },
      { source: "draft", target: "elsewhere" },
    ]
    expect(resolveUpstreamKieTaskId("hd", {}, nodes, edges)).toBe("task-draft")
  })

  it("undefined when nothing upstream carries one", () => {
    expect(resolveUpstreamKieTaskId("hd", {}, nodes, [{ source: "other", target: "hd" }])).toBeUndefined()
    expect(resolveUpstreamKieTaskId("hd", undefined, nodes, [])).toBeUndefined()
  })
})

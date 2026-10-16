// @test-watches packages/client/src/resources/edit.ts
/**
 * A run's use-case type, as every surface reads it from the job row (the
 * continue route, the MCP verb): the type its input records, else its
 * job_type. And the SDK's own copy of the type list — it cannot import this
 * package — names exactly the types the registry has, so a new use-case node
 * reaches `continueUseCase` and the CLI's `--type` the day it ships.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseRunType } from "@nodaro/render-rules"

describe("usecaseRunType", () => {
  it("reads the type the run's input records", () => {
    expect(usecaseRunType({ type: "tighten-episode", mode: "run" }, "tighten-episode")).toBe("tighten-episode")
  })
  it("the recorded type wins over the job_type", () => {
    expect(usecaseRunType({ type: "tighten-episode" }, "apply-edl")).toBe("tighten-episode")
  })
  it("a recorded type that names no use-case node is no run, whatever the job_type says", () => {
    expect(usecaseRunType({ type: "apply-edl" }, "tighten-episode")).toBeNull()
  })
  it("a row whose input records no type is read by its job_type", () => {
    expect(usecaseRunType({ mode: "run" }, "tighten-episode")).toBe("tighten-episode")
    expect(usecaseRunType({ type: "" }, "tighten-episode")).toBe("tighten-episode")
    expect(usecaseRunType(null, "tighten-episode")).toBe("tighten-episode")
    expect(usecaseRunType(["tighten-episode"], "tighten-episode")).toBe("tighten-episode")
  })
  it("anything else is no run of a use-case node", () => {
    expect(usecaseRunType({ edl: {} }, "apply-edl")).toBeNull()
    expect(usecaseRunType(undefined, null)).toBeNull()
    expect(usecaseRunType({ type: 7 }, 7)).toBeNull()
  })
})

describe("the SDK's use-case type list", () => {
  it("names exactly the registry's types", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "client", "src", "resources", "edit.ts"), "utf8")
    const match = source.match(/export const USE_CASE_NODE_TYPES = \[([^\]]*)\] as const/)
    expect(match, "packages/client/src/resources/edit.ts declares USE_CASE_NODE_TYPES").not.toBeNull()
    const sdkTypes = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...sdkTypes].sort()).toEqual([...USE_CASE_NODE_TYPES].sort())
  })
})

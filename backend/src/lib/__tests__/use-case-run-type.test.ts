// @test-watches frontend/src/nodes/** backend/src/nodes/** packages/client/src/resources/edit.ts
/**
 * A run's use-case type, as every surface reads it from the job row (the
 * continue route, the MCP verb): the type its input records, else its
 * job_type. And the SDK's type list is shared's list itself (it re-exports
 * `@nodaro/shared/nodes`), the one render-rules and the backend's route bodies
 * are built from, so a new use-case node reaches `continueUseCase` and the
 * CLI's `--type` the day it ships; the SDK's copy of Trailer's formats (the
 * CLI's `--formats`) is the builder's, in order.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { TRAILER_FORMATS, USE_CASE_NODE_TYPES, usecaseRunType } from "@nodaro/render-rules"
import { USE_CASE_NODE_TYPES as SHARED_USE_CASE_NODE_TYPES } from "@nodaro/shared/nodes"
import { USE_CASE_NODE_TYPES as SDK_USE_CASE_NODE_TYPES } from "../../../../packages/client/src/resources/edit.js"
import { USE_CASE_BODIES } from "../use-case/bodies.js"

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
  it("is shared's list itself, the one render-rules and the backend's route bodies carry", () => {
    expect(SDK_USE_CASE_NODE_TYPES).toBe(SHARED_USE_CASE_NODE_TYPES)
    expect([...SDK_USE_CASE_NODE_TYPES]).toEqual([...USE_CASE_NODE_TYPES])
    expect(Object.keys(USE_CASE_BODIES).sort()).toEqual([...SDK_USE_CASE_NODE_TYPES].sort())
  })
  it("its Trailer formats are the builder's, in delivery order", () => {
    const source = readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "client", "src", "resources", "edit.ts"), "utf8")
    const match = source.match(/export const TRAILER_FORMATS = \[([^\]]*)\] as const/)
    expect(match, "packages/client/src/resources/edit.ts declares TRAILER_FORMATS").not.toBeNull()
    expect([...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...TRAILER_FORMATS])
  })
})

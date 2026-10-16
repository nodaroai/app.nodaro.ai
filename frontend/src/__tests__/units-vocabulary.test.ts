// @test-watches tools/units/** frontend/src/types/nodes.ts frontend/src/lib/handle-colors.ts frontend/src/lib/node-families.ts packages/shared/src/producer-types.ts packages/shared/src/presentation-utils.ts backend/src/lib/queue.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { NODE_FAMILIES } from "@/lib/node-families"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { familyIdsFrom, loadUnits } from "../../../tools/units/manifest.mjs"
import { CATEGORIES, HANDLE_KINDS, OUTPUT_TYPES, PRODUCER_KINDS, QUEUES } from "../../../tools/units/vocabulary.mjs"

/**
 * The runtime twins of the node-unit guards (tools/units/README.md): the
 * validator's closed vocabularies (tools/units/vocabulary.mjs) are pinned to
 * the product sources they mirror, and G1 is checked on the composed
 * NODE_DEFINITIONS the editor really loads.
 */

const ROOT = path.resolve(__dirname, "../../..")
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8")
const unionOf = (source: string, name: string) => {
  const m = source.match(new RegExp(`export type ${name} = ([^\\n]+)`))
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null
}

describe("G1 twin — the composed NODE_DEFINITIONS", () => {
  it("has exactly the legacy types plus the units, each once", () => {
    const legacy = JSON.parse(read("tools/units/legacy-nodes.json")).types as string[]
    const units = loadUnits(ROOT).map((u: { type: string }) => u.type)
    const types = NODE_DEFINITIONS.map((d) => d.type as string)
    expect(new Set(types).size).toBe(types.length)
    expect([...types].sort()).toEqual([...legacy, ...units].sort())
  })
})

describe("the validator's vocabularies are the product's", () => {
  it("categories = NodeCategory", () => {
    expect(CATEGORIES).toEqual(unionOf(read("frontend/src/types/nodes.ts"), "NodeCategory"))
    for (const d of NODE_DEFINITIONS) expect(CATEGORIES).toContain(d.category)
  })

  it("handle kinds = the HANDLE_COLORS keys", () => {
    expect(HANDLE_KINDS).toEqual(Object.keys(HANDLE_COLORS))
  })

  it("family ids (read textually by the validator) = NODE_FAMILIES' ids", () => {
    expect(familyIdsFrom(read("frontend/src/lib/node-families.ts"))).toEqual(NODE_FAMILIES.map((f) => f.id))
  })

  it("producer kinds = the producer sets of @nodaro/shared", () => {
    const src = read("packages/shared/src/producer-types.ts")
    const sets = [...src.matchAll(/export const ([A-Z]+)_PRODUCER_TYPES\b/g)].map((m) => m[1].toLowerCase())
    expect([...PRODUCER_KINDS].sort()).toEqual([...sets].sort())
  })

  it("output types = OutputType | \"none\"", () => {
    expect(OUTPUT_TYPES).toEqual([...(unionOf(read("packages/shared/src/presentation-utils.ts"), "OutputType") ?? []), "none"])
  })

  it("every queue a unit may name exists", () => {
    expect(QUEUES).toEqual(["video"])
    expect(read("backend/src/lib/queue.ts")).toMatch(/export const videoQueue = new Queue\("video-generation"/)
  })
})

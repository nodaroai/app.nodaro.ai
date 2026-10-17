// @test-watches tools/units/** frontend/src/types/nodes.ts frontend/src/lib/handle-colors.ts frontend/src/lib/node-families.ts frontend/src/lib/canvas-macros.ts frontend/src/lib/*macro*.ts frontend/src/lib/node-options.tsx backend/src/ee/billing/credits.ts packages/shared/src/producer-types.ts packages/shared/src/presentation-utils.ts backend/src/lib/queue.ts backend/src/lib/node-registry.ts backend/src/services/workflow-engine/payload-builder.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { NODE_FAMILIES } from "@/lib/node-families"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { familyIdsFrom, familyTypesFrom, loadUnits, repoContext } from "../../../tools/units/manifest.mjs"
import { NODE_OPTIONS } from "@/lib/node-options"
import { isCanvasMacroType } from "@/lib/canvas-macros"
import { ACCEPTS_KINDS, CATEGORIES, HANDLE_KINDS, MEDIA_INPUT_KINDS, OUTPUT_TYPES, PRODUCER_KINDS, QUEUES, REGISTRY_CATEGORIES } from "../../../tools/units/vocabulary.mjs"
import { unitInputAccepts } from "@/lib/ffmpeg-handles"
import type { UnitHandleKind } from "@/nodes/kit"

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

  it("every add-node option that is not a node type (a canvas macro) is a reserved id (read textually)", () => {
    const nodeTypes = new Set(NODE_DEFINITIONS.map((d) => d.type as string))
    const reserved = repoContext(ROOT).reserved as Map<string, string>
    const notNodes = [...new Set(NODE_OPTIONS.map((o) => o.type as string))].filter((t) => !nodeTypes.has(t))
    expect(notNodes.length).toBeGreaterThan(0)
    expect(notNodes.filter((t) => !reserved.has(t))).toEqual([])
  })

  it("family members (read textually for picker.after) = NODE_FAMILIES' legacy types", () => {
    const textual = familyTypesFrom(read("frontend/src/lib/node-families.ts"))
    const unitTypes = new Set(loadUnits(ROOT).map((u: { type: string }) => u.type))
    for (const f of NODE_FAMILIES) {
      expect(textual.get(f.id), f.id).toEqual(f.types.filter((t) => !isCanvasMacroType(t) && !unitTypes.has(t)))
    }
  })

  it("producer kinds = the producer sets of @nodaro/shared", () => {
    const src = read("packages/shared/src/producer-types.ts")
    const sets = [...src.matchAll(/export const ([A-Z]+)_PRODUCER_TYPES\b/g)].map((m) => m[1].toLowerCase())
    expect([...PRODUCER_KINDS].sort()).toEqual([...sets].sort())
  })

  it("output types = OutputType | \"none\"", () => {
    expect(OUTPUT_TYPES).toEqual([...(unionOf(read("packages/shared/src/presentation-utils.ts"), "OutputType") ?? []), "none"])
  })

  it("registry categories = the editor categories /v1/nodes shares (node-registry.ts maps a unit onto them)", () => {
    const block = read("backend/src/lib/node-registry.ts").match(/export type NodeCategory =([\s\S]*?)\n\n/)?.[1] ?? ""
    const server = [...block.matchAll(/"([^"]+)"/g)].map((x) => x[1])
    expect(REGISTRY_CATEGORIES).toEqual(CATEGORIES.filter((c: string) => server.includes(c)))
    expect(read("backend/src/lib/node-registry.ts")).toContain(`const UNIT_REGISTRY_CATEGORIES = [${REGISTRY_CATEGORIES.map((c: string) => JSON.stringify(c)).join(", ")}] as const`)
  })

  it("every input kind a unit may accept has an editor connection rule", () => {
    const kinds = (ACCEPTS_KINDS as string[]).filter((k): k is UnitHandleKind => Object.hasOwn(HANDLE_COLORS, k))
    expect(kinds).toEqual(ACCEPTS_KINDS)
    for (const k of kinds) expect(typeof unitInputAccepts([k])).toBe("function")
    expect(typeof unitInputAccepts(kinds)).toBe("function")
  })

  it("required-media kinds = RequiredMediaInput.kind of the payload builder", () => {
    expect(read("backend/src/services/workflow-engine/payload-builder.ts")).toContain(`readonly kind: ${MEDIA_INPUT_KINDS.map((k: string) => JSON.stringify(k)).join(" | ")}`)
  })

  it("every queue a unit may name exists", () => {
    expect(QUEUES).toEqual(["video"])
    expect(read("backend/src/lib/queue.ts")).toMatch(/export const videoQueue = new Queue\("video-generation"/)
  })
})

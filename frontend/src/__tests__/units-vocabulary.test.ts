// @test-watches tools/units/** frontend/src/nodes/kit.ts packages/render-rules/src/use-case-*.ts packages/shared/src/json-kinds.ts frontend/src/types/nodes.ts frontend/src/lib/handle-colors.ts frontend/src/lib/node-families.ts frontend/src/lib/canvas-macros.ts frontend/src/lib/*macro*.ts frontend/src/lib/node-options.tsx backend/src/ee/billing/credits.ts packages/shared/src/producer-types.ts packages/shared/src/presentation-utils.ts backend/src/lib/queue.ts backend/src/lib/node-registry.ts backend/src/services/workflow-engine/payload-builder.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { NODE_FAMILIES, PICKER_TABS as PRODUCT_PICKER_TABS } from "@/lib/node-families"
import { HANDLE_COLORS } from "@/lib/handle-colors"
import { familyIdsFrom, familyTypesFrom, loadUnits, repoContext } from "../../../tools/units/manifest.mjs"
import { NODE_OPTIONS } from "@/lib/node-options"
import { isCanvasMacroType } from "@/lib/canvas-macros"
import { ACCEPTS_KINDS, CATEGORIES, EXECUTION_KINDS, HANDLE_KINDS, JSON_PIP_KINDS, MANY_KINDS, MEDIA_INPUT_KINDS, OUTPUT_TYPES, PICKER_TABS, PRESENTS, PRODUCER_KINDS, QUEUES, REGISTRY_CATEGORIES, USE_CASE_INPUT_HANDLES } from "../../../tools/units/vocabulary.mjs"
import { unitInputAccepts } from "@/lib/ffmpeg-handles"
import { ACCEPTS_JSON } from "@/lib/data-handles"
import type { UnitHandleKind } from "@/nodes/kit"
import { USE_CASE_NODE_TYPES } from "@nodaro/shared/nodes"

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

  it("lists the use-case types in USE_CASE_NODE_TYPES order — the editor's composed order is the one order", () => {
    const useCase = USE_CASE_NODE_TYPES as readonly string[]
    expect(
      [...USE_CASE_NODE_TYPES],
      "the use-case units are listed in position order — shared's list (generated) and the composed definitions must agree",
    ).toEqual(NODE_DEFINITIONS.map((d) => d.type as string).filter((t) => useCase.includes(t)))
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

  it("producer kinds = UnitProducerKind of the editor kit (the projected `producer` of a unit definition)", () => {
    expect([...(unionOf(read("frontend/src/nodes/kit.ts"), "UnitProducerKind") ?? [])].sort()).toEqual([...PRODUCER_KINDS].sort())
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

  it("a JSON input's rule is ACCEPTS_JSON; an input taking every wire takes media streams only", () => {
    expect(ACCEPTS_KINDS).toContain("look")
    expect(unitInputAccepts(["look"])).toBe(ACCEPTS_JSON)
    expect(MANY_KINDS).toEqual(["video", "audio"])
    for (const k of MANY_KINDS) {
      expect(ACCEPTS_KINDS).toContain(k)
      expect(MEDIA_INPUT_KINDS).toContain(k)
    }
  })

  it("required-media kinds = RequiredMediaInput.kind of the payload builder", () => {
    expect(read("backend/src/services/workflow-engine/payload-builder.ts")).toContain(`readonly kind: ${MEDIA_INPUT_KINDS.map((k: string) => JSON.stringify(k)).join(" | ")}`)
  })

  it("use-case input pips = UseCaseInputHandle of @nodaro/render-rules", () => {
    expect(USE_CASE_INPUT_HANDLES).toEqual(unionOf(read("packages/render-rules/src/use-case-registry.ts"), "UseCaseInputHandle"))
  })

  it("picker tabs a family can own = NodeFamily[\"tab\"] (every PickerTab but common/all, plus controls)", () => {
    expect(read("frontend/src/lib/node-families.ts")).toContain('readonly tab: Exclude<PickerTab, "common" | "all"> | "controls"')
    expect(PICKER_TABS).toEqual([...PRODUCT_PICKER_TABS.filter((t) => t !== "common" && t !== "all"), "controls"])
    for (const f of NODE_FAMILIES) expect(PICKER_TABS).toContain(f.tab)
  })

  it("JSON pip kinds = JsonOutputDeclaration (JsonKind | \"other\")", () => {
    const src = read("packages/shared/src/json-kinds.ts")
    expect(src).toContain('export type JsonOutputDeclaration = JsonKind | "other"')
    expect(JSON_PIP_KINDS).toEqual([...(unionOf(src, "JsonKind") ?? []), "other"])
  })

  it("presents = OutputType but \"data\" (the four *_OUTPUT_TYPES sets getOutputType reads)", () => {
    expect(PRESENTS).toEqual((unionOf(read("packages/shared/src/presentation-utils.ts"), "OutputType") ?? []).filter((t) => t !== "data"))
    // NON_OUTPUT_TYPES lists the nodes that present nothing — not a presentation.
    const src = read("packages/shared/src/presentation-utils.ts")
    const sets = [...src.matchAll(/^const ([A-Z]+)_OUTPUT_TYPES = (?:new Set|composeUnitSet)\(/gm)].map((m) => m[1].toLowerCase()).filter((k) => k !== "non")
    expect([...PRESENTS].sort()).toEqual([...sets].sort())
    // Each of the four composes the units that declare ITS presentation (contract.presents):
    // each declaration, read up to the next one, names itself and calls unitsPresenting once, with its own kind.
    const chunks = src.split(/^(?=const [A-Z]+_OUTPUT_TYPES = )/m).slice(1)
    const composed = chunks.flatMap((chunk) => {
      const head = chunk.match(/^const ([A-Z]+)_OUTPUT_TYPES = composeUnitSet\("([A-Z_]+)"/)
      if (!head) return []
      const kinds = [...chunk.matchAll(/unitsPresenting\("([a-z]+)"\)/g)].map((m) => m[1])
      return [{ name: head[1], label: head[2], kinds }]
    })
    expect(composed.map((c) => c.name.toLowerCase()).sort()).toEqual([...PRESENTS].sort())
    for (const c of composed) {
      expect(c.label, c.name).toBe(`${c.name}_OUTPUT_TYPES`)
      expect(c.kinds, c.name).toEqual([c.name.toLowerCase()])
    }
  })

  it("every execution.kind but source is executable — use-case included (the editor runs it through executeUseCase)", () => {
    expect(EXECUTION_KINDS.filter((k: string) => k !== "source")).toContain("use-case")
  })

  it("every queue a unit may name exists", () => {
    expect(QUEUES).toEqual(["video"])
    expect(read("backend/src/lib/queue.ts")).toMatch(/export const videoQueue = new Queue\("video-generation"/)
  })
})

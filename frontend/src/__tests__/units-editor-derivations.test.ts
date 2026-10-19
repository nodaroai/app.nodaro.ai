// @test-units-by-name composes only the in-memory fixture units it declares (mocked into the definitions door) beside the real ones
import { describe, expect, it, vi } from "vitest"
import type { UnitDefinition } from "@/nodes/kit"
// vi.mock below is hoisted above these imports, so each module loads with the fixtures.
import { TEXT_PRODUCING_SOURCE_TYPES } from "@/lib/main-text-handle"
import { TEXT_SOURCE_TYPES } from "@/components/editor/config-panels/helpers"
import { TEXT_PRODUCER_TYPES } from "@/lib/generate-image-handles"
import { JSON_PRODUCER_TYPES } from "@/lib/data-handles"
import { NO_MEDIUM_RESULT_TYPES } from "@/components/editor/config-panels/results-gallery-media"
import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { NODE_FAMILIES, TAB_SUPERSET } from "@/lib/node-families"
import { buildAdjacency, isValidWorkflowConnection } from "@/lib/connection-validation"

/**
 * The editor registries a node unit's manifest reaches, loaded for real with
 * two in-memory fixture units added to the definitions door
 * (lib/unit-definitions.ts) — no real unit uses these derivations yet, so a
 * fixture proves each one lands: the text / JSON / no-medium sets, the
 * exclusive capability, a runtime-typed pip, the tab superset (whose module
 * must load with a unit that declares picker.alsoOnTabs) and the unit-input
 * connection rule. The pure helpers are tested in lib/__tests__/unit-compose.test.ts.
 */
const FIXTURES = vi.hoisted((): UnitDefinition[] => {
  const base = {
    category: "processing",
    defaultData: {},
    execution: { kind: "use-case", builder: "fixture" },
    docs: {},
    priceRows: {},
  } as const
  return [
    // A plan-and-render use-case: media in, the episode (runtime-typed) and its plan out.
    {
      ...base,
      type: "fixture-case",
      label: "Fixture Case",
      inputs: ["media", "music"],
      outputs: ["media", "json"],
      defaultData: { label: "Fixture Case" },
      position: { after: "apply-edl" },
      picker: { family: "video-podcast", after: "episode-chapters" },
      handles: {
        inputs: [
          { id: "media", label: "Recording", accepts: ["video", "audio"] },
          { id: "music", label: "Music", accepts: ["audio"] },
        ],
        outputs: [
          { id: "media", label: "Episode", kind: "video", runtimeTyped: true },
          { id: "json", label: "Plan", kind: "look" },
        ],
      },
      capabilities: ["edition:nodaro-exclusive", "panel:generate-button"],
      producer: "dynamic",
    },
    // A notes use-case: text first, a JSON list, no medium, also on the Audio tab.
    {
      ...base,
      type: "fixture-notes",
      label: "Fixture Notes",
      inputs: ["media"],
      outputs: ["text", "json"],
      defaultData: { label: "Fixture Notes" },
      position: { after: "fixture-case" },
      picker: { family: "video-podcast", after: "tighten-episode", alsoOnTabs: ["audio"] },
      handles: {
        inputs: [{ id: "media", label: "Recording", accepts: ["video", "audio"] }],
        outputs: [
          { id: "text", label: "Show notes", kind: "text" },
          { id: "json", label: "Chapters", kind: "look" },
        ],
      },
      capabilities: ["edition:nodaro-exclusive", "panel:generate-button"],
      producer: null,
    },
  ]
})

vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const all = [...real.UNIT_NODE_DEFINITIONS, ...FIXTURES]
  return { ...real, UNIT_NODE_DEFINITIONS: all, unitDefinitionOf: (type: string | undefined) => all.find((u) => u.type === type) }
})

describe("the derived editor registries carry a unit from its manifest", () => {
  it("text sources: a unit whose first output is text, in all three text lists", () => {
    for (const has of [(t: string) => TEXT_PRODUCING_SOURCE_TYPES.has(t), (t: string) => TEXT_SOURCE_TYPES.includes(t), (t: string) => TEXT_PRODUCER_TYPES.has(t)]) {
      expect(has("fixture-notes")).toBe(true)
      expect(has("fixture-case")).toBe(false)
    }
  })

  it("JSON producers, no-medium gallery results, the exclusive capability", () => {
    expect(["fixture-case", "fixture-notes"].filter((t) => JSON_PRODUCER_TYPES.has(t))).toEqual(["fixture-case", "fixture-notes"])
    // fixture-case's media pip is runtime-typed but still a medium.
    expect(["fixture-case", "fixture-notes"].filter((t) => NO_MEDIUM_RESULT_TYPES.has(t))).toEqual(["fixture-notes"])
    expect(["fixture-case", "fixture-notes"].filter((t) => NODARO_EXCLUSIVE_NODE_TYPES.has(t))).toEqual(["fixture-case", "fixture-notes"])
  })

  it("a runtime-typed pip gets no HANDLE_OUTPUT_TYPES row", () => {
    expect(HANDLE_OUTPUT_TYPES["fixture-case"]).toEqual({ json: "look" })
    expect(HANDLE_OUTPUT_TYPES["fixture-notes"]).toEqual({ text: "text", json: "look" })
  })

  it("the tab superset loads with a unit on picker.alsoOnTabs and lists it in family order", () => {
    // The family's real members (read off the tree, so a later podcast unit needs no edit here) come
    // first, in their own order, and the fixtures after them: units naming the same picker.after keep
    // type order (Chapters, a unit, before fixture-notes), and a unit may follow a unit (fixture-case
    // after Chapters, behind the real units that also follow it). The superset lists them in family order.
    const types: readonly string[] = NODE_FAMILIES.find((f) => f.id === "video-podcast")?.types ?? []
    const real = types.filter((t) => t !== "fixture-case" && t !== "fixture-notes")
    expect(real.slice(0, 2)).toEqual(["tighten-episode", "episode-chapters"])
    expect(types).toEqual([...real, "fixture-case", "fixture-notes"])
    expect(TAB_SUPERSET.audio?.["video-podcast"]).toEqual(["tighten-episode", "episode-chapters", "fixture-notes"])
    // The other rows are untouched (a type from another family keeps its slot).
    expect(TAB_SUPERSET.video?.["video-add-your-own"]).toEqual(["youtube-video", "text-prompt"])
  })
})

describe("the unit-input connection rule", () => {
  const typeOf = (id: string) => ({ rec: "upload-video", bed: "upload-audio", img: "upload-image", c: "fixture-case", n: "fixture-notes" } as Record<string, string>)[id]
  it("each input takes what it declares; an undeclared handle takes nothing", () => {
    const ok = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
      isValidWorkflowConnection({ source, target, sourceHandle, targetHandle }, typeOf)
    expect(ok("rec", "video", "c", "media")).toBe(true)
    expect(ok("bed", "audio", "c", "media")).toBe(true)
    expect(ok("bed", "audio", "c", "music")).toBe(true)
    expect(ok("rec", "video", "c", "music")).toBe(false)
    expect(ok("img", "image", "c", "media")).toBe(false)
    expect(ok("rec", "video", "c", "intro")).toBe(false)
    expect(ok("rec", "video", "n", "media")).toBe(true)
  })
  it("the generic checks before it still answer first", () => {
    // A self-loop, and a wire that would close a cycle, are refused though the media rule would take them.
    expect(isValidWorkflowConnection({ source: "c", target: "c", sourceHandle: "media", targetHandle: "media" }, () => "fixture-case")).toBe(false)
    const graph = buildAdjacency([{ source: "c", target: "n" }])
    expect(isValidWorkflowConnection({ source: "n", target: "c", sourceHandle: "media", targetHandle: "media" }, (id) => (id === "n" ? "upload-video" : "fixture-case"), graph)).toBe(false)
  })
})

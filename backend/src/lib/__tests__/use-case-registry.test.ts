/**
 * Every use-case type has one descriptor, and it is total: a label, a route
 * under /v1 named after the type, "media" first among its inputs, an input
 * node id for every input (media's own source included), and a builder whose
 * graph carries the type and the descriptor's result kind.
 */
import { describe, it, expect } from "vitest"
import {
  USE_CASE_DESCRIPTORS,
  USE_CASE_MASTER_NODE_ID,
  USE_CASE_MAX_RECORDINGS,
  USE_CASE_NODE_TYPES,
  usecaseContinuePath,
  usecaseDescriptor,
  USE_CASE_SPECS,
  usecaseKindHasPlan,
  usecaseListsItsResult,
  usecasePlanNodeId,
  usecaseRecordingNodeId,
  usecaseResultKind,
  usecaseTypeOfBuilder,
} from "@nodaro/render-rules"

/** The builders that read several recordings (decided 2026-10-17): the others take one until their multicam work. */
const MULTICAM_BUILDERS: ReadonlySet<string> = new Set(["tighten", "trailer", "clipPack", "speakerLayout"])
const multicamType = (type: string): boolean => [...MULTICAM_BUILDERS].some((b) => usecaseTypeOfBuilder(b) === type)

describe("the use-case registry", () => {
  it("has exactly one descriptor per type", () => {
    expect(Object.keys(USE_CASE_DESCRIPTORS).sort()).toEqual([...USE_CASE_NODE_TYPES].sort())
  })
  for (const type of USE_CASE_NODE_TYPES) {
    describe(type, () => {
      const d = usecaseDescriptor(type)
      it("names its route after the type and its continue path after the route", () => {
        expect(d.type).toBe(type)
        expect(d.route).toBe(`/v1/${type}`)
        expect(usecaseContinuePath(type)).toBe(`/v1/${type}/continue`)
      })
      it("takes the recording first, and names the built node every input replaces", () => {
        expect(d.inputs[0]).toBe("media")
        for (const h of d.inputs) expect(typeof d.inputNodeIds[h]).toBe("string")
      })
      it("takes the recordings it builds (Tighten, Trailer, Clip Pack and Speaker Layout six, the others one), and its first recording is the built source every builder names", () => {
        expect(d.maxRecordings).toBe(multicamType(type) ? USE_CASE_MAX_RECORDINGS : 1)
        expect(d.inputNodeIds.media).toBe(usecaseRecordingNodeId(0))
      })
      it("builds a graph of its own type and result kind", () => {
        const g = d.build(d.resolveSettings({}, "video"), { media: { url: "https://r2/ep.mp4", kind: "video" } })
        expect(g.nodeType).toBe(type)
        expect(usecaseResultKind(g.outputMap)).toBe(d.resultKind)
        expect(usecaseListsItsResult(type)).toBe(d.resultKind === "clips" || d.resultKind === "formats")
      })
    })
  }
  it("tighten-episode is the P1 node", () => {
    const d = usecaseDescriptor("tighten-episode")
    expect(d).toMatchObject({ label: "Tighten Episode", reviewable: true, resultKind: "episode", needsVideo: false, inputs: ["media", "music", "masterAudio"] })
    // Its Master audio pip (unit.json) replaces the built Master audio.
    expect(d.inputNodeIds).toEqual({ media: "uc-source", music: "uc-music", masterAudio: "uc-master" })
    expect(d.settingKeys).toEqual(["output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount", "cameras", "framingSource"])
  })
  it("a builder that builds several recordings names the built Master audio its wire replaces", () => {
    expect(USE_CASE_SPECS.tighten.inputNodeIds.masterAudio).toBe(USE_CASE_MASTER_NODE_ID)
    const g = usecaseDescriptor("tighten-episode").build(
      usecaseDescriptor("tighten-episode").resolveSettings({ captions: false }, "video", { recordings: 1, masterAudio: true }),
      { media: { url: "https://r2/cam1.mp4", kind: "video" }, masterAudio: { url: "https://r2/master.wav", kind: "audio" } },
    )
    expect(g.nodes.find((n) => n.id === USE_CASE_MASTER_NODE_ID)).toMatchObject({ type: "upload-audio" })
  })
  it("every builder spec declares how many recordings it takes: Tighten, Trailer, Clip Pack and Speaker Layout up to six (decided 2026-10-17), the others one until their multicam work", () => {
    for (const [key, spec] of Object.entries(USE_CASE_SPECS)) expect(spec.maxRecordings, key).toBe(MULTICAM_BUILDERS.has(key) ? USE_CASE_MAX_RECORDINGS : 1)
  })
  it("Speaker Layout's descriptor: its label and inputs from its row (unit.json), the rest from its spec", () => {
    const d = usecaseDescriptor(usecaseTypeOfBuilder("speakerLayout"))
    expect(d).toMatchObject({
      label: "Speaker Layout",
      inputs: ["media", "masterAudio"],
      reviewable: true,
      resultKind: "layout",
      needsVideo: true,
      wholeClipRender: true,
      outputLength: { kind: "clock" },
      inputNodeIds: { media: "uc-source", masterAudio: USE_CASE_MASTER_NODE_ID },
      settingKeys: USE_CASE_SPECS.speakerLayout.settingKeys,
    })
    expect(d.triesEvery).toBeUndefined()
    expect(d.audioForced).toBeUndefined()
    expect(usecaseListsItsResult(d.type)).toBe(false)
  })
  it("a type has a plan exactly when its built graph names one (usecaseKindHasPlan is usecasePlanNodeId's type-level twin): only a layout has none", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      const d = usecaseDescriptor(type)
      const g = d.build(d.resolveSettings({}, "video"), { media: { url: "https://r2/ep.mp4", kind: "video" } })
      expect(usecaseKindHasPlan(d.resultKind)).toBe(usecasePlanNodeId(g.outputMap) !== null)
    }
    expect(usecaseKindHasPlan("layout")).toBe(false)
  })
  it("anything else is not a list-result type", () => {
    expect(usecaseListsItsResult("apply-edl")).toBe(false)
    expect(usecaseListsItsResult(undefined)).toBe(false)
  })
})

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
  usecaseListsItsResult,
  usecaseRecordingNodeId,
  usecaseResultKind,
} from "@nodaro/render-rules"

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
      it("takes the recordings it builds (Tighten and Trailer six, the others one), and its first recording is the built source every builder names", () => {
        expect(d.maxRecordings).toBe(type === "tighten-episode" || type === "episode-trailer" ? USE_CASE_MAX_RECORDINGS : 1)
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
  it("every builder spec declares how many recordings it takes: Tighten and Trailer up to six (decided 2026-10-17), the others one until their multicam work", () => {
    for (const [key, spec] of Object.entries(USE_CASE_SPECS)) expect(spec.maxRecordings, key).toBe(key === "tighten" || key === "trailer" ? USE_CASE_MAX_RECORDINGS : 1)
  })
  it("anything else is not a list-result type", () => {
    expect(usecaseListsItsResult("apply-edl")).toBe(false)
    expect(usecaseListsItsResult(undefined)).toBe(false)
  })
})

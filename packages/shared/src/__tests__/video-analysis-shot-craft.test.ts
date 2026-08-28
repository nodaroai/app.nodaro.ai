import { describe, it, expect } from "vitest"
import {
  VIDEO_ANALYSIS_TEXT_KINDS, VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN, VIDEO_ANALYSIS_TRANSITIONS,
  windowAnalysisSchema, videoAnalysisResultSchema,
} from "../video-analysis.js"

const scene = { startSec: 0, endSec: 4, label: "hook", shotType: "Wide", camera: "static", visual: "{slot:a} waits", audio: [] }
const slot = { slotId: "a", label: "A", source: "wired-character", role: "person", description: "d" }

describe("shot-craft fields (keys only)", () => {
  it("adds a text-kind vocabulary and a clip transition-in vocabulary without widening the transition enum", () => {
    expect(VIDEO_ANALYSIS_TEXT_KINDS).toEqual(["title", "caption", "lower-third", "subtitle", "logo", "other"])
    expect(VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN).toEqual(["fade"])
    expect(VIDEO_ANALYSIS_TRANSITIONS).toEqual(["cut", "fade", "dissolve", "wipe", "whip"])
  })
  it("window and result accept transitionIn at the CLIP level and onScreenTextKind on a scene", () => {
    const w = windowAnalysisSchema.parse({ transitionIn: "fade", slots: [slot], scenes: [{ ...scene, onScreenText: "HELLO", onScreenTextKind: "title", transitionOut: "cut" }] })
    expect(w.transitionIn).toBe("fade")
    expect(w.scenes[0]!.onScreenTextKind).toBe("title")
    const r = videoAnalysisResultSchema.parse({
      meta: { durationSec: 4, width: 16, height: 9, aspectRatio: "16:9" }, transitionIn: "fade", slots: [slot],
      scenes: [{ ...scene, sceneNumber: 1, visualResolved: "A waits", slotRefs: ["a"], onScreenTextKind: "subtitle", onScreenText: "hi" }],
    })
    expect(r.transitionIn).toBe("fade")
  })
  it("a pre-change result still parses, and an unknown key is stripped (readers never break)", () => {
    const r = videoAnalysisResultSchema.parse({
      meta: { durationSec: 4, width: 16, height: 9, aspectRatio: "16:9" }, slots: [slot],
      scenes: [{ ...scene, sceneNumber: 1, visualResolved: "A waits", slotRefs: ["a"], futureKey: 1 }],
    })
    expect(r.transitionIn).toBeUndefined()
    expect((r.scenes[0] as Record<string, unknown>).futureKey).toBeUndefined()
  })
  it("rejects a value outside the vocabularies", () => {
    expect(() => windowAnalysisSchema.parse({ transitionIn: "wipe", slots: [], scenes: [] })).toThrow()
    expect(() => windowAnalysisSchema.parse({ slots: [], scenes: [{ ...scene, onScreenTextKind: "banner" }] })).toThrow()
  })
})

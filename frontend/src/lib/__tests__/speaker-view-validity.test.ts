/**
 * The badge's verdict on a Speaker View edit (C3.2): the plugin's refusals,
 * mirrored, and what the render does differently as notes. The rule itself is
 * pinned to the plugin by backend/src/lib/__tests__/speaker-view-parity.test.ts;
 * these pin what the badge makes of it.
 */
import { describe, it, expect } from "vitest"
import { speakerViewBatchValidity, speakerViewValidity } from "../speaker-view-validity"

const src = (id: string, extra: Record<string, unknown> = {}) => ({ id, url: `https://x/${id}.mp4`, kind: "video", ...extra })
const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio", role: "master-audio" }
const seg = (id: string, inS: number, video: string, speaker?: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}) })
const edl = (sources: unknown[], segments: unknown[]) => ({ version: 1, clock: "master", sources: [MIC, ...sources], segments })
const TWO = edl([src("a"), src("b")], [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")])

describe("speakerViewValidity", () => {
  it("is null while nothing is wired and unparseable for text that is not JSON", () => {
    expect(speakerViewValidity({ edl: undefined, settings: {} })).toBeNull()
    expect(speakerViewValidity({ edl: "  ", settings: {} })).toBeNull()
    expect(speakerViewValidity({ edl: "{nope", settings: {} })).toMatchObject({ ok: false, unparseable: true })
  })

  it("passes a named two-camera edit, from an object or its JSON string", () => {
    expect(speakerViewValidity({ edl: TWO, settings: {} })).toMatchObject({ ok: true, issues: [] })
    expect(speakerViewValidity({ edl: JSON.stringify(TWO), settings: {} })!.ok).toBe(true)
  })

  it("refuses what the plugin refuses, in the rule's words (SV24: no speaker on a multicam edit)", () => {
    const unnamed = edl([src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b")])
    const v = speakerViewValidity({ edl: unnamed, settings: {} })!
    expect(v.ok).toBe(false)
    expect(v.issues[0]).toMatch(/Wire Camera Switch between Edit Plan and Speaker View/)
  })

  it("lets one transcript label through SV24, and refuses an unlabelled transcript", () => {
    const unnamed = edl([src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b")])
    const one = { words: [{ text: "x", startMs: 0, endMs: 1, speaker: "speaker_0" }] }
    const none = { words: [{ text: "x", startMs: 0, endMs: 1 }] }
    expect(speakerViewValidity({ edl: unnamed, transcript: one, settings: {} })!.ok).toBe(true)
    expect(speakerViewValidity({ edl: unnamed, transcript: none, settings: {} })!.ok).toBe(false)
  })

  it("never refuses a fully named edit for its transcript (the relaxed SV24)", () => {
    expect(speakerViewValidity({ edl: TWO, transcript: { words: [{ text: "x", startMs: 0, endMs: 1 }] }, settings: {} })!.ok).toBe(true)
  })

  it("a late camera is a NOTE, not a refusal (decided 2026-10-06)", () => {
    const late = edl([src("a"), src("b"), src("c", { offsetMs: 12_000 })], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "a", "H"), seg("s3", 15, "c", "P")])
    const v = speakerViewValidity({ edl: late, settings: { layout: "grid" } })!
    expect(v.ok).toBe(true)
    expect(v.warnings.join("\n")).toMatch(/had not begun/)
  })

  it("refuses a segment whose own camera has not begun", () => {
    const own = edl([src("a"), src("b", { offsetMs: 8000 })], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G")])
    expect(speakerViewValidity({ edl: own, settings: { layout: "single" } })!.issues.join("\n")).toMatch(/before source "b" begins/)
  })

  it("judges the node's settings after the normalizer: a layout the aspect rules out snaps, it is not refused", () => {
    expect(speakerViewValidity({ edl: TWO, settings: { layout: "side-by-side", targetAspect: "9:16" } })!.ok).toBe(true)
  })

  it("refuses a list as one render", () => {
    expect(speakerViewValidity({ edl: [TWO], settings: {} })).toMatchObject({ ok: false, issues: ["expected one EDL, got a list"] })
  })
})

describe("speakerViewBatchValidity (a clip pack, SV23)", () => {
  it("is null with nothing, the one verdict for one clip, and names the failing clip of a pack", () => {
    expect(speakerViewBatchValidity([], undefined, {})).toBeNull()
    expect(speakerViewBatchValidity([TWO], undefined, {})!.kind).toBe("edl")
    const bad = edl([src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b")])
    const pack = speakerViewBatchValidity([TWO, bad], undefined, {})!
    expect(pack.kind).toBe("clips")
    expect(pack.ok).toBe(false)
    expect(pack.issues.every((m) => m.startsWith("clip[1]: "))).toBe(true)
  })
  it("parses each clip of a Camera Switch batch of JSON strings", () => {
    expect(speakerViewBatchValidity([JSON.stringify(TWO), JSON.stringify(TWO)], undefined, {})!.ok).toBe(true)
  })
})

import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"

// B4 (decided 2026-09-25): audio-sync's measured offsets reach edit-plan's
// `sources[].offsetMs` HERE — before the reserve, so a plan that would render
// out of sync fails before charging. buildPayload is pure (the reserve-test
// harness): no mocks.

const ctx = { nodes: [], edges: [], nodeStates: {} }
const node = (data: Record<string, unknown> = {}) => ({
  id: "ep1",
  type: "edit-plan",
  data: { mode: "tighten", planTier: "standard", ...data },
})
const build = (resolvedInputs: Record<string, unknown>, data: Record<string, unknown> = {}) =>
  buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 800 }, { text: "bye", startMs: 59_000, endMs: 60_000 }] }
const MIC = { nodeId: "mic", url: "https://cdn.example/mic.wav", kind: "audio" as const, label: "Zoom H6" }
const CAM_A = { nodeId: "cam-a", url: "https://cdn.example/a.mp4", kind: "video" as const, label: "Camera A" }
const CAM_B = { nodeId: "cam-b", url: "https://cdn.example/b.mp4", kind: "video" as const, label: "Wide" }
const masterRole = { sourceConfig: { mic: { role: "master-audio" } } }
const row = (sourceId: string, offsetMs: number, confidence = 0.9) => ({ sourceId, offsetMs, confidence, driftMsPerHour: 0 })
/** The canvas json handle carries audio-sync's result stringified. */
const sync = (...offsets: ReturnType<typeof row>[]) => JSON.stringify({ version: 1, reference: "mic", offsets, notes: [] })

type Payload = { sources: Array<{ id: string; offsetMs?: number }>; transcript: { sourceId?: string } }
const payloadOf = (out: ReturnType<typeof build>) => out.payload as unknown as Payload
const offsetsOf = (out: ReturnType<typeof build>) => Object.fromEntries(payloadOf(out).sources.map((s) => [s.id, s.offsetMs]))

describe("edit-plan payload — audio-sync offsets onto the sources (B4)", () => {
  it("writes each camera's measured offset onto its source; the master keeps its clock", () => {
    const out = build({
      transcript: JSON.stringify(transcript),
      editPlanSources: [MIC, CAM_A, CAM_B],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000), row("cam-b", -1_500)),
    }, masterRole)
    expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": 2_000, "cam-b": -1_500 })
    // The raw audio-sync result never rides the payload — only the offsets do.
    expect(out.payload).not.toHaveProperty("offsets")
  })

  it("a hand-set offset (the panel's sourceConfig) wins over the measured one", () => {
    const out = build({
      transcript,
      editPlanSources: [MIC, CAM_A],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
    }, { sourceConfig: { mic: { role: "master-audio" }, "cam-a": { offsetMs: 1_950 } } })
    expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": 1_950 })
  })

  it("a weak match fails before the reserve, naming the camera by its label", () => {
    expect(() => build({
      transcript,
      editPlanSources: [MIC, CAM_A],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000, 0.31)),
    }, masterRole)).toThrow(/^edit-plan: audio-sync's match for "Camera A" is too weak to trust \(confidence 0.31; 0.5 needed\) — set its offset by hand$/)
  })

  it("a camera audio-sync did not measure fails before the reserve", () => {
    expect(() => build({
      transcript,
      editPlanSources: [MIC, CAM_A, CAM_B],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
    }, masterRole)).toThrow(/"Wide" was not measured by audio-sync — wire it into audio-sync, or set its offset by hand/)
  })

  it("an offsets wire with no audio-sync result (null) fails rather than planning unsynced", () => {
    expect(() => build({ transcript, editPlanSources: [MIC, CAM_A], editPlanOffsets: null }, masterRole))
      .toThrow(/the offsets carry no Audio Sync result/)
  })

  it("no offsets wire → today's behaviour: sources as configured, no check beyond the master's own offset", () => {
    const out = build({ transcript, editPlanSources: [MIC, CAM_A] }, masterRole)
    expect(offsetsOf(out)).toEqual({ mic: undefined, "cam-a": undefined })
    expect(() => build({ transcript, editPlanSources: [MIC, CAM_A] }, { sourceConfig: { mic: { role: "master-audio", offsetMs: 40 } } }))
      .toThrow(/"Zoom H6" is the master \(the plan follows its clock\), so its offset must be 0, not 40 ms/)
  })

  it("a transcript made from an offset camera fails before the reserve (the cuts would land off by its offset)", () => {
    expect(() => build({
      transcript,
      editPlanSources: [MIC, CAM_A],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
      editPlanTranscriptOrigin: "cam-a",
    }, masterRole)).toThrow(/the transcript was made from "Camera A", which is 2000 ms off the master "Zoom H6"/)
  })

  it("a transcript made from the master is stamped with its source id, for the plugin's own clock guard", () => {
    const out = build({
      transcript: JSON.stringify(transcript),
      editPlanSources: [MIC, CAM_A],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
      editPlanTranscriptOrigin: "mic",
    }, masterRole)
    expect(payloadOf(out).transcript.sourceId).toBe("mic")
  })

  it("anchors on the first source when none is marked master — rebasing audio-sync's mic-referenced offsets onto it", () => {
    const out = build({
      transcript,
      editPlanSources: [CAM_A, MIC],
      editPlanOffsets: sync(row("mic", 0, 1), row("cam-a", 2_000)),
    })
    expect(offsetsOf(out)).toEqual({ "cam-a": undefined, mic: -2_000 })
  })
})

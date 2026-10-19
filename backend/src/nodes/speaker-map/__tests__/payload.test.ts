import { describe, it, expect, vi } from "vitest"
import { payload } from "../payload.js"
import type { UnitPayloadKit } from "../../kit.js"

type Row = { id: string; url: string; kind: "video" | "audio" }
const row = (id: string, kind: Row["kind"] = "video"): Row => ({ id, url: `https://media.test/${id}.${kind === "video" ? "mp4" : "m4a"}`, kind })
const TRANSCRIPT = { text: "hi there", words: [{ text: "hi", startMs: 0, endMs: 500, speaker: "A" }, { text: "there", startMs: 1000, endMs: 1500, speaker: "B" }] }
const OFFSETS = { version: 1, reference: "cam1", offsets: [{ sourceId: "cam1", offsetMs: 0, confidence: 1 }, { sourceId: "cam2", offsetMs: 120, confidence: 0.9 }], notes: [] }

function kit(unitInputs: Record<string, unknown> | undefined, data: Record<string, unknown> = {}): UnitPayloadKit {
  return {
    node: { id: "map", type: "speaker-map", data } as UnitPayloadKit["node"],
    data: { label: "Speaker Map", ...data },
    resolvedInputs: (unitInputs ? { unitInputs } : {}) as UnitPayloadKit["resolvedInputs"],
    jobId: "job-1",
    usageLogId: "ul-1",
    ffmpegResult: vi.fn((jobName: string, p: Record<string, unknown>) => ({ jobName, payload: p }) as unknown as ReturnType<UnitPayloadKit["ffmpegResult"]>),
  }
}
const wired = (over: Record<string, unknown> = {}) => ({ sources: [row("cam1"), row("cam2")], offsets: JSON.stringify(OFFSETS), transcript: JSON.stringify(TRANSCRIPT), ...over })

describe("speaker-map payload", () => {
  it("a speaker-map video-queue job on the wired recordings, offsets and transcript, at the default 3 dB lead", () => {
    const k = kit(wired())
    payload(k)
    expect(k.ffmpegResult).toHaveBeenCalledWith("speaker-map", {
      jobId: "job-1",
      sources: [row("cam1"), row("cam2")],
      transcript: TRANSCRIPT,
      offsets: OFFSETS,
      marginDb: 3,
      usageLogId: "ul-1",
    })
  })

  it("the sources follow data.sourceOrder (listed first, then wire order); master and wide go through when wired", () => {
    const k = kit(wired({ sources: [row("cam1"), row("cam2"), row("mic", "audio")] }), { sourceOrder: ["mic", 7, "cam2"], masterSourceId: "mic", wideSourceId: "cam1", marginDb: 6 })
    payload(k)
    const sent = (k.ffmpegResult as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>
    expect((sent.sources as Row[]).map((s) => s.id)).toEqual(["mic", "cam2", "cam1"])
    expect(sent).toMatchObject({ masterSourceId: "mic", wideSourceId: "cam1", marginDb: 6 })
  })

  it("a master or wide naming a recording that is no longer wired is dropped, not sent", () => {
    const k = kit(wired(), { masterSourceId: "gone", wideSourceId: "also-gone" })
    payload(k)
    const sent = (k.ffmpegResult as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>
    expect("masterSourceId" in sent).toBe(false)
    expect("wideSourceId" in sent).toBe(false)
  })

  it("no offsets wired: the key is left out (the recordings are read as already in sync)", () => {
    const { offsets: _o, ...noOffsets } = wired()
    const k = kit(noOffsets)
    payload(k)
    expect("offsets" in ((k.ffmpegResult as ReturnType<typeof vi.fn>).mock.calls[0]![1] as object)).toBe(false)
  })

  it("a marginDb that is not a finite number falls back to 3; one past the route's range is clamped to it", () => {
    for (const [given, sent] of [["6", 3], [Number.NaN, 3], [Number.POSITIVE_INFINITY, 3], [-2, 0], [99, 30]] as const) {
      const k = kit(wired(), { marginDb: given })
      payload(k)
      expect(((k.ffmpegResult as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { marginDb: number }).marginDb, String(given)).toBe(sent)
    }
  })

  it("never mutates the node's data or the resolved inputs", () => {
    const inputs = wired({ sources: [row("cam1"), row("cam2")] })
    const data = { sourceOrder: ["cam2"] }
    const before = JSON.stringify([inputs, data])
    payload(kit(inputs, data))
    expect(JSON.stringify([inputs, data])).toBe(before)
  })

  describe("refused before any reserve (the orchestrated path bypasses the route's Zod)", () => {
    const refuses = (unitInputs: Record<string, unknown> | undefined, message: string, data: Record<string, unknown> = {}) => {
      const k = kit(unitInputs, data)
      expect(() => payload(k)).toThrow(message)
      expect(k.ffmpegResult).not.toHaveBeenCalled()
    }

    it("fewer than two recordings: one wired, none wired, or nothing wired at all", () => {
      const msg = 'speaker-map: node "Speaker Map" needs at least 2 recordings — connect them to the Cameras input'
      refuses(wired({ sources: [row("cam1")] }), msg)
      refuses(wired({ sources: [] }), msg)
      refuses(undefined, msg)
    })

    it("more than six recordings", () => {
      refuses(wired({ sources: ["a", "b", "c", "d", "e", "f", "g"].map((id) => row(id)) }), 'speaker-map: node "Speaker Map" takes at most 6 recordings — 7 are connected to the Cameras input')
    })

    it("a List wired as a whole (its items joined into one value) is named, not counted as one recording", () => {
      const joined = { id: "list", url: "https://media.test/a.mp4, https://media.test/b.mp4", kind: "video" as const }
      refuses(wired({ sources: [joined] }), 'speaker-map: node "Speaker Map" received several recordings joined into one from "list" — connect each recording to the Cameras input on its own')
    })

    it("a source that is not a fetchable media URL", () => {
      refuses(wired({ sources: [row("cam1"), { id: "txt", url: "not-a-url", kind: "video" }] }), 'speaker-map: node "Speaker Map" received something that is not a media URL from "txt" — check the connection feeding its Cameras input')
      refuses(wired({ sources: [row("cam1"), { id: "lan", url: "http://127.0.0.1/a.mp4", kind: "video" }] }), 'from "lan"')
    })

    it("no transcript wired", () => {
      const { transcript: _t, ...noTranscript } = wired()
      refuses(noTranscript, 'speaker-map: node "Speaker Map" needs a transcript — connect Transcribe (with speaker detection on) to its Transcript input')
    })

    it("a transcript wire whose upstream produced nothing", () => {
      refuses(wired({ transcript: "" }), 'speaker-map: node "Speaker Map" got nothing on its Transcript input — run the node wired to it first')
    })

    it("a transcript with no speaker labels", () => {
      refuses(wired({ transcript: JSON.stringify({ text: "hi", words: [{ text: "hi", startMs: 0, endMs: 1000 }] }) }), "speaker-map: the transcript has no speaker labels — turn on speaker detection in Transcribe.")
    })

    it("an offsets wire whose upstream produced nothing, or that is not an Audio Sync result", () => {
      refuses(wired({ offsets: "" }), 'speaker-map: node "Speaker Map" got nothing on its Offsets input — run the node wired to it first, or disconnect it')
      refuses(wired({ offsets: JSON.stringify({ text: "a transcript" }) }), 'speaker-map: node "Speaker Map" received something that is not an Audio Sync result on its Offsets input — connect Audio Sync\'s output to it')
    })

    it("a wide shot on a sound-only recording, or master and wide on the same recording", () => {
      const three = wired({ sources: [row("cam1"), row("cam2"), row("mic", "audio")] })
      refuses(three, 'speaker-map: node "Speaker Map" has the sound-only recording "mic" as its wide shot — pick a camera', { wideSourceId: "mic" })
      refuses(three, 'speaker-map: node "Speaker Map" has "cam1" as both its master audio and its wide shot — pick a different one for each', { masterSourceId: "cam1", wideSourceId: "cam1" })
    })
  })
})

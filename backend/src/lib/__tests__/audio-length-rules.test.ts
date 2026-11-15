/**
 * The audio steps the measured walk can bound (`AUDIO_LENGTH_RULES`,
 * @nodaro/render-rules, decided 2026-11-14): Extract Audio, Audio Isolation
 * and Trim Audio's window. Each is an UPPER BOUND on the file the step makes,
 * and each makes a new file (its run re-encodes), so a measuring step's slack
 * is added once after it, as after the steps that re-render their input. What
 * they are given and do not know stays unknown. Mix Audio has no row yet (it
 * is read as before). The editor's and the server's estimates are held to each
 * other by the measured-input parity fixture.
 */
import { describe, expect, it } from "vitest"
import {
  AUDIO_LENGTH_RULES,
  LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC,
  VIDEO_LENGTH_RULES,
  measuredWireLengthSec,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "@nodaro/render-rules"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"

type N = EstimateGraphNode & { readonly type: string; readonly data?: Record<string, unknown> }
const video = (id: string, sec: number): N => ({ id, type: "upload-video", data: { url: `https://cdn.example/${id}.mp4`, generatedResults: [{ url: `https://cdn.example/${id}.mp4`, duration: sec }], activeResultIndex: 0 } })
const audio = (id: string, sec: number): N => ({ id, type: "upload-audio", data: { url: `https://cdn.example/${id}.mp3`, metadata: { durationSeconds: sec } } })
/** An audio a node makes in the run whose length nothing knows (a voice with no take). */
const voice = (id: string): N => ({ id, type: "text-to-speech", data: { text: "hello" } })
const wire = (source: string, target: string, targetHandle: string): EstimateGraphEdge => ({ source, target, targetHandle })
const SLACK = 0.1
/** The walk from `id`, every node running, at the measuring step's slack. */
const read = (id: string, nodes: N[], edges: EstimateGraphEdge[]) => measuredWireLengthSec(id, nodes, edges, new Set(nodes.map((n) => n.id)), { plannedClipSlackSec: SLACK })

describe("the table", () => {
  it("names exactly the three audio steps, each an audio producer that delivers no video", () => {
    expect(Object.keys(AUDIO_LENGTH_RULES).sort()).toEqual(["audio-isolation", "extract-audio", "trim-audio"])
    for (const type of Object.keys(AUDIO_LENGTH_RULES)) {
      expect(AUDIO_PRODUCER_TYPES.has(type), type).toBe(true)
      expect(VIDEO_PRODUCER_TYPES.has(type) || DYNAMIC_PRODUCER_TYPES.has(type), type).toBe(false)
      // A type lives in one table.
      expect(Object.hasOwn(VIDEO_LENGTH_RULES, type), type).toBe(false)
    }
  })

  it("no row is a carrier: each step makes a new file, so the slack lands once after it", () => {
    for (const [type, rule] of Object.entries(AUDIO_LENGTH_RULES)) expect(rule.carries, type).toBeUndefined()
  })
})

describe("Extract Audio: its video's sound, as long as the video", () => {
  it("a 12 s video upload: 12 s, plus the slack", () => {
    expect(read("x", [video("v", 12), { id: "x", type: "extract-audio", data: {} }], [wire("v", "x", "in")])).toBeCloseTo(12 + SLACK, 12)
  })
  it("a video of unknown length: unknown", () => {
    expect(read("x", [{ id: "v", type: "upload-video", data: { url: "https://cdn.example/v.mp4" } }, { id: "x", type: "extract-audio", data: {} }], [wire("v", "x", "in")])).toBeUndefined()
  })
})

describe("Audio Isolation: its audio's voice, as long as the audio", () => {
  it("an 8 s audio upload: 8 s, plus a quarter second (read as a Dubbing's file, past the step's own slack)", () => {
    expect(LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC).toBeGreaterThan(SLACK)
    expect(read("i", [audio("a", 8), { id: "i", type: "audio-isolation", data: {} }], [wire("a", "i", "audio")])).toBeCloseTo(8 + LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC, 12)
  })
  it("a voice made in the run: unknown", () => {
    expect(read("i", [voice("t"), { id: "i", type: "audio-isolation", data: {} }], [wire("t", "i", "audio")])).toBeUndefined()
  })
})

describe("Trim Audio: its window (its run's -ss start -to end), at most its input", () => {
  const trim = (data: Record<string, unknown>): N => ({ id: "t", type: "trim-audio", data })
  it("a window inside the input: the window, plus the slack", () => {
    expect(read("t", [video("v", 75), trim({ startTime: 2, endTime: 7 })], [wire("v", "t", "in")])).toBeCloseTo(5 + SLACK, 12)
  })
  it("a window past the input's end: up to the input's end", () => {
    expect(read("t", [audio("a", 12), trim({ startTime: 0, endTime: 100 })], [wire("a", "t", "in")])).toBeCloseTo(12 + SLACK, 12)
  })
  it("no end: the rest of the input after the start", () => {
    expect(read("t", [audio("a", 12), trim({ startTime: 2 })], [wire("a", "t", "in")])).toBeCloseTo(10 + SLACK, 12)
    expect(read("t", [audio("a", 12), trim({})], [wire("a", "t", "in")])).toBeCloseTo(12 + SLACK, 12)
  })
  it("an end that is not after the start: read as the rest of the input (an upper bound)", () => {
    expect(read("t", [audio("a", 12), trim({ startTime: 5, endTime: 3 })], [wire("a", "t", "in")])).toBeCloseTo(7 + SLACK, 12)
  })
  it("an input of unknown length: the window still bounds it; with no end, unknown", () => {
    expect(read("t", [voice("s"), trim({ startTime: 1, endTime: 9 })], [wire("s", "t", "in")])).toBeCloseTo(8 + SLACK, 12)
    expect(read("t", [voice("s"), trim({ startTime: 1 })], [wire("s", "t", "in")])).toBeUndefined()
  })
  it("a start past the input's end: nothing left, the slack only", () => {
    expect(read("t", [audio("a", 12), trim({ startTime: 20, endTime: 30 })], [wire("a", "t", "in")])).toBeCloseTo(SLACK, 12)
    expect(read("t", [audio("a", 12), trim({ startTime: 20 })], [wire("a", "t", "in")])).toBeCloseTo(SLACK, 12)
  })
})

describe("Mix Audio is read as before (no row yet)", () => {
  const mix = (data: Record<string, unknown> = {}): N => ({ id: "m", type: "mix-audio", data })
  it("ending with its voice: the voice's length, exactly; ending with its longest track: unknown", () => {
    expect(read("m", [audio("a", 8), audio("b", 12), mix({ duckUnder: "a", endAt: "voice" })], [wire("a", "m", "in"), wire("b", "m", "in")])).toBe(8)
    expect(read("m", [audio("a", 8), audio("b", 12), mix()], [wire("a", "m", "in"), wire("b", "m", "in")])).toBeUndefined()
  })
})

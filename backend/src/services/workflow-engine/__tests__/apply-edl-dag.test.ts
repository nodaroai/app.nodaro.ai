/**
 * DAG-vs-single-node parity for apply-edl — the C4 dual-handle node.
 *
 * apply-edl is the first node with BOTH a dynamic media output handle and a
 * fixed `json` handle, so the two failure modes this locks in are:
 *   1. the `json` (transcript) edge resolving to the VIDEO url via the generic
 *      `text||imageUrl||videoUrl||audioUrl` tail (the audit-dag break the
 *      backend-DAG correction targets), and
 *   2. the payload builder throwing "Unknown node type" / mis-routing the EDL
 *      because the `edl` json input wasn't threaded.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { getPrimaryOutput, extractSavedNodeOutput } from "../output-extractor.js"
import type { SimpleNode, ResolvedInputs, NodeOutput } from "../types.js"
import type { Edl, Transcript } from "@nodaro/shared"

const JOB_ID = "job-apply-edl"

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 2000, video: "A", audio: "A" },
    { id: "s1", inMs: 4000, outMs: 6000, video: "A", audio: "A" },
  ],
}

const TRANSCRIPT: Transcript = {
  version: 1,
  words: [
    { text: "kept", startMs: 500, endMs: 900 },
    { text: "dropped", startMs: 2500, endMs: 2900 },
    { text: "again", startMs: 4500, endMs: 4900 },
  ],
}

describe("apply-edl payload builder", () => {
  it("threads the wired EDL (json string) into the effective-EDL payload on the video queue", () => {
    const node: SimpleNode = { id: "ae1", type: "apply-edl", data: { output: "video", quality: "final" } }
    const inputs: ResolvedInputs = { edl: JSON.stringify(EDL) }
    const result = buildPayload(node, JOB_ID, inputs, "usage-1")
    expect(result.jobName).toBe("apply-edl")
    expect(result.queueName).toBe("video-generation")
    expect(result.modelIdentifier).toBe("apply-edl")
    const payloadEdl = result.payload.edl as Edl
    expect(payloadEdl.segments).toHaveLength(2)
    expect(payloadEdl.sources[0].url).toBe("https://media.test/a.mp4")
    expect(result.payload.output).toBe("video")
  })

  it("applies positional `sources` overrides to the effective EDL", () => {
    const node: SimpleNode = { id: "ae2", type: "apply-edl", data: {} }
    const inputs: ResolvedInputs = { edl: JSON.stringify(EDL), sources: ["https://override.test/new.mp4"] }
    const result = buildPayload(node, JOB_ID, inputs, "usage-1")
    const payloadEdl = result.payload.edl as Edl
    expect(payloadEdl.sources[0].url).toBe("https://override.test/new.mp4")
  })

  it("throws (never 'Unknown node type') when the EDL is unusable", () => {
    const node: SimpleNode = { id: "ae3", type: "apply-edl", data: { output: "video" } }
    // A video-output edit with a picture-less segment must fail at build time.
    const badEdl = { ...EDL, segments: [{ id: "s0", inMs: 0, outMs: 1000 }] }
    const inputs: ResolvedInputs = { edl: JSON.stringify(badEdl) }
    expect(() => buildPayload(node, JOB_ID, inputs, "usage-1")).toThrow(/apply-edl: invalid EDL/)
  })

  it("refuses an edit over the 3-hour output cap at build time — before the executor reserves anything", () => {
    // buildPayload runs before the node executor's reservation step, and its
    // throw deletes the placeholder row: a refused EDL reserves nothing.
    const node: SimpleNode = { id: "ae4", type: "apply-edl", data: { output: "video" } }
    const long = { ...EDL, segments: [{ id: "s0", inMs: 0, outMs: 181 * 60_000, video: "A", audio: "A" }] }
    expect(() => buildPayload(node, JOB_ID, { edl: JSON.stringify(long) }, "usage-1")).toThrow(
      /apply-edl: invalid EDL — the edit renders 181 minutes of output — over the 180-minute limit for one render/,
    )
  })

  it("carries the transcript through to the payload for remap", () => {
    const node: SimpleNode = { id: "ae4", type: "apply-edl", data: {} }
    const inputs: ResolvedInputs = { edl: JSON.stringify(EDL), transcript: JSON.stringify(TRANSCRIPT) }
    const result = buildPayload(node, JOB_ID, inputs, "usage-1")
    expect(result.payload.transcript).toBe(JSON.stringify(TRANSCRIPT))
  })
})

describe("apply-edl output routing (getPrimaryOutput)", () => {
  const remapped: Transcript = { version: 1, words: [{ text: "kept", startMs: 0, endMs: 400 }] }
  const videoOut: NodeOutput = { videoUrl: "https://r2.test/cut.mp4", json: remapped }
  const audioOut: NodeOutput = { audioUrl: "https://r2.test/cut.m4a", json: remapped }

  it("resolves the `json` handle to the remapped transcript, NOT the video url", () => {
    const out = getPrimaryOutput(videoOut, "apply-edl", "json")
    expect(out).toBe(JSON.stringify(remapped))
    expect(out).not.toContain("cut.mp4")
  })

  it("resolves the default (media) handle to the video url", () => {
    expect(getPrimaryOutput(videoOut, "apply-edl", undefined)).toBe("https://r2.test/cut.mp4")
    expect(getPrimaryOutput(videoOut, "apply-edl", "media")).toBe("https://r2.test/cut.mp4")
  })

  it("resolves the default handle to the audio url in audio mode", () => {
    expect(getPrimaryOutput(audioOut, "apply-edl", undefined)).toBe("https://r2.test/cut.m4a")
    expect(getPrimaryOutput(audioOut, "apply-edl", "json")).toBe(JSON.stringify(remapped))
  })
})

describe("apply-edl saved-output hydration (extractSavedNodeOutput)", () => {
  it("exposes BOTH the media url and the json transcript from node data (skipped / run-from-here)", () => {
    const remapped: Transcript = { version: 1, words: [] }
    const node: SimpleNode = {
      id: "ae5",
      type: "apply-edl",
      data: { generatedVideoUrl: "https://r2.test/cut.mp4", generatedJson: remapped },
    }
    const saved = extractSavedNodeOutput(node)
    expect(saved?.videoUrl).toBe("https://r2.test/cut.mp4")
    expect(saved?.json).toEqual(remapped)
    // The json handle then routes to the transcript, the default to the media.
    expect(getPrimaryOutput(saved!, "apply-edl", "json")).toBe(JSON.stringify(remapped))
    expect(getPrimaryOutput(saved!, "apply-edl", undefined)).toBe("https://r2.test/cut.mp4")
  })

  it("hydrates the audio url in audio mode", () => {
    const node: SimpleNode = { id: "ae6", type: "apply-edl", data: { generatedAudioUrl: "https://r2.test/cut.m4a" } }
    const saved = extractSavedNodeOutput(node)
    expect(saved?.audioUrl).toBe("https://r2.test/cut.m4a")
    expect(saved?.videoUrl).toBeUndefined()
  })
})

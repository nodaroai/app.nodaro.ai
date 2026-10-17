// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  combineRunUpstreamDurations,
  getUpstreamDuration,
  getCombineUpstreamDurations,
  runWireDurationReader,
} from "../upstream-duration"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { usecaseTakeResultFields } from "../use-case-run-result"

function makeNode(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

function makeEdge(source: string, target: string, targetHandle: string = "in"): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, targetHandle } as unknown as WorkflowEdge
}

describe("getUpstreamDuration", () => {
  it("reads generatedResults[activeResultIndex].duration", () => {
    const upstream = makeNode("u1", "image-to-video", {
      generatedResults: [{ url: "x", timestamp: "", jobId: "j1", duration: 7 }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(7)
  })

  it("falls back to data.duration when no generated results", () => {
    const upstream = makeNode("u1", "image-to-video", { duration: 5 })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(5)
  })

  it("returns undefined when upstream has neither", () => {
    const upstream = makeNode("u1", "upload-video", {})
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBeUndefined()
  })

  it("returns undefined when no incoming edge", () => {
    const target = makeNode("t1", "loop-video", {})
    expect(getUpstreamDuration("t1", [target], [])).toBeUndefined()
  })

  it("prefers generatedResults[activeIdx].duration over data.duration", () => {
    const upstream = makeNode("u1", "image-to-video", {
      duration: 99,
      generatedResults: [{ url: "x", timestamp: "", jobId: "j1", duration: 3 }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(3)
  })

  it("reads generatedResults[activeResultIndex].duration for generate-video upstream", () => {
    const upstream = makeNode("u1", "generate-video", {
      generatedResults: [{ url: "x", timestamp: "", jobId: "j1", duration: 11 }],
      activeResultIndex: 0,
    })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(11)
  })

  it("falls back to data.duration for generate-video upstream when no generated results", () => {
    const upstream = makeNode("u1", "generate-video", { duration: 8 })
    const target = makeNode("t1", "loop-video", {})
    const edges = [makeEdge("u1", "t1")]
    expect(getUpstreamDuration("t1", [upstream, target], edges)).toBe(8)
  })
})

describe("getCombineUpstreamDurations", () => {
  it("returns durations in clipOrder when present", () => {
    const u1 = makeNode("u1", "image-to-video", { duration: 5 })
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", { clipOrder: ["u2", "u1"] })
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([10, 5])
  })

  it("returns durations by edge order when clipOrder is empty", () => {
    const u1 = makeNode("u1", "image-to-video", { duration: 5 })
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", {})
    // edges declared with stable id ordering
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([5, 10])
  })

  it("includes undefined for upstreams missing duration", () => {
    const u1 = makeNode("u1", "upload-video", {})
    const u2 = makeNode("u2", "image-to-video", { duration: 10 })
    const target = makeNode("t1", "combine-videos", { clipOrder: ["u1", "u2"] })
    const edges = [makeEdge("u1", "t1"), makeEdge("u2", "t1")]
    expect(getCombineUpstreamDurations(target, [u1, u2, target], edges)).toEqual([undefined, 10])
  })
})

// What the editor's RUN sends — the read the server's run charges by
// (`runForwardedVideoLengthSec`, backend run-forwarded-length.test.ts holds the
// server's side to the same cases).
describe("the run's length on a wire (runWireDurationReader)", () => {
  it("a chain: an upload (40 s) → Trim (keep the first 23 s) hands the Loop 23 s, not the 8 s fallback", () => {
    const up = makeNode("up", "upload-video", { url: "https://m.test/up.mp4", generatedResults: [{ url: "https://m.test/up.mp4", duration: 40 }] })
    const trim = makeNode("trim", "trim-video", { trimMode: "keep-first-seconds", keepFirstSeconds: 23, generatedResults: [{ url: "https://m.test/t.mp4" }] })
    const loop = makeNode("loop", "loop-video", {})
    const nodes = [up, trim, loop]
    const edges = [makeEdge("up", "trim"), makeEdge("trim", "loop")]
    expect(getUpstreamDuration("loop", nodes, edges, runWireDurationReader(nodes, edges, "https://m.test/t.mp4"))).toBe(23)
  })

  it("a render's take: the length of the cut it recorded", () => {
    const render = makeNode("r", "apply-edl", { generatedResults: [{ url: "https://m.test/cut.mp4", duration: 190 }] })
    const trim = makeNode("t", "trim-video", {})
    expect(getUpstreamDuration("t", [render, trim], [makeEdge("r", "t")], runWireDurationReader([render, trim], [makeEdge("r", "t")], "https://m.test/cut.mp4"))).toBe(190)
  })

  it("a Tighten Episode's take, as the canvas's run lands it: the episode's length its run reported (decided 2026-10-16)", () => {
    const url = "https://m.test/episode.mp4"
    const output = { videoUrl: url, quality: "final", durationSec: 1834.5, _executionId: "e" }
    const t1 = makeNode("t1", "tighten-episode", { generatedVideoUrl: url, generatedResults: [{ url, ...usecaseTakeResultFields("tighten-episode", output) }], activeResultIndex: 0 })
    const trim = makeNode("t", "trim-video", {})
    const edges = [makeEdge("t1", "t")]
    expect(getUpstreamDuration("t", [t1, trim], edges, runWireDurationReader([t1, trim], edges, url))).toBe(1834.5)
    expect(getUpstreamDuration("t", [t1, trim], edges)).toBe(1834.5)
  })

  it("an Upload Video with a link pasted over an earlier upload: not the earlier file's length", () => {
    const up = makeNode("up", "upload-video", { url: "https://elsewhere.test/p.mp4", generatedResults: [{ url: "https://m.test/old.mp4", duration: 40 }], activeResultIndex: 0 })
    const trim = makeNode("t", "trim-video", {})
    const edges = [makeEdge("up", "t")]
    expect(getUpstreamDuration("t", [up, trim], edges)).toBeUndefined()
    expect(getUpstreamDuration("t", [up, trim], edges, runWireDurationReader([up, trim], edges, "https://elsewhere.test/p.mp4"))).toBeUndefined()
  })
})

describe("combineRunUpstreamDurations — one length per CLIP, as the server's run sends", () => {
  const clips = ["https://m.test/c1.mp4", "https://m.test/c2.mp4", "https://m.test/c3.mp4"]
  const finish = makeNode("finish", "ugc-finish-clips", {
    __listResults: clips,
    __listResultMeta: [{ warnings: [], durationSec: 6.2 }, { warnings: [], durationSec: 7.1 }, { warnings: [], durationSec: 13.4 }],
  })
  const join = makeNode("join", "combine-videos", {})
  const edges = [makeEdge("finish", "join")]

  it("a Bundle of finished UGC clips: each clip at its own real length", () => {
    const entries = clips.map((url) => ({ nodeId: "finish", url }))
    expect(combineRunUpstreamDurations(clips, entries, [finish, join], edges)).toEqual([6.2, 7.1, 13.4])
    // The per-wire view had one entry for the three clips, so the request dropped every length.
    expect(getCombineUpstreamDurations(join, [finish, join], edges)).toHaveLength(1)
  })

  it("follows a reordered clip list by url", () => {
    const entries = clips.map((url) => ({ nodeId: "finish", url }))
    expect(combineRunUpstreamDurations([clips[2], clips[0]], entries, [finish, join], edges)).toEqual([13.4, 6.2])
  })

  it("a clip with no known source stays undefined", () => {
    expect(combineRunUpstreamDurations(["https://m.test/x.mp4"], [], [finish, join], edges)).toEqual([undefined])
  })
})

import { describe, it, expect } from "vitest"
import { CHAPTERS_NODE_IDS as ID, EPISODE_CHAPTERS_DEFAULTS, buildEpisodeChaptersGraph, initialRunNodeIds, resolveEpisodeChaptersSettings, usecaseRenderNodeId } from "@nodaro/render-rules"

const video = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 2700 }

describe("Chapters builds transcribe → Edit Plan (chapters)", () => {
  it("defaults: economy tier, no instructions", () => {
    expect(resolveEpisodeChaptersSettings(undefined, "video")).toEqual(EPISODE_CHAPTERS_DEFAULTS)
    expect(EPISODE_CHAPTERS_DEFAULTS.planTier).toBe("economy")
    expect(resolveEpisodeChaptersSettings({ planTier: "ultra", instructions: 4 }, "audio")).toEqual(EPISODE_CHAPTERS_DEFAULTS)
  })
  it("golden graph", () => {
    const g = buildEpisodeChaptersGraph(resolveEpisodeChaptersSettings({ instructions: "Short titles" }, "video"), { media: video })
    expect(g.nodeType).toBe("episode-chapters")
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([[ID.source, "upload-video"], [ID.transcribe, "transcribe"], [ID.plan, "edit-plan"]])
    expect(g.nodes.find((n) => n.id === ID.source)!.data).toMatchObject({ url: video.url, metadata: { durationSeconds: 2700 } })
    expect(g.nodes.find((n) => n.id === ID.transcribe)!.data).toMatchObject({ provider: "elevenlabs-stt", diarize: true })
    expect(g.nodes.find((n) => n.id === ID.plan)!.data).toMatchObject({ mode: "chapters", planTier: "economy", instructions: "Short titles", sourceOrder: [ID.source] })
    expect(g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)).toEqual([
      `${ID.source}.video>${ID.transcribe}.audio`,
      `${ID.source}.video>${ID.plan}.sources`,
      `${ID.transcribe}.json>${ID.plan}.transcript`,
    ])
    expect(g.outputMap).toEqual({ kind: "chapters", json: { nodeId: ID.plan, handle: "edl" }, transcript: { nodeId: ID.transcribe, handle: "json" }, planNodeId: ID.plan })
  })
  it("an audio recording reads its audio pip; nothing renders, so there is no preview subset", () => {
    const g = buildEpisodeChaptersGraph(EPISODE_CHAPTERS_DEFAULTS, { media: { url: "https://r2/ep.m4a", kind: "audio" } })
    expect(g.nodes[0]!.type).toBe("upload-audio")
    expect(g.edges[0]!.sourceHandle).toBe("audio")
    expect(usecaseRenderNodeId(g.outputMap)).toBeNull()
    expect(initialRunNodeIds(g)).toBeNull()
  })
})

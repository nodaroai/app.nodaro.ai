import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "../helpers"
import { buildVideoAnalysisCreditId, resolveVideoAnalysisModel } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"

/**
 * The run-level estimates (Execute-button badge, run-confirm dialog, pre-run
 * precheck) price a node by `getModelIdentifier(node)` → model-cost cache. For
 * video-analysis that id MUST be the same tier+duration composite the node's
 * own badge builds (`buildVideoAnalysisCreditId`) — NEVER the bare
 * "video-analysis" id, whose model_pricing row is deliberately seeded at the
 * absolute worst case (smart @ 600s ceiling). Falling through to the bare id
 * is what made the confirm dialog quote ~1868 credits for a run that billed
 * 149 (mixed @ 180s), reported 2026-08-03.
 */

function vaNode(data: Record<string, unknown>): WorkflowNode {
  return {
    id: "va-1",
    type: "video-analysis",
    position: { x: 0, y: 0 },
    data: { label: "Video Analysis", ...data },
  } as unknown as WorkflowNode
}

describe("getModelIdentifier — video-analysis", () => {
  it("prices a mixed-tier node with a trusted wired probe at the probed bucket", () => {
    const node = vaNode({
      llmModel: "mixed",
      videoUrl: "https://cdn.example/clip.mp4",
      probedVideo: { url: "https://cdn.example/clip.mp4", durationSec: 72 },
    })
    expect(getModelIdentifier(node)).toBe("video-analysis:mixed:180s")
  })

  it("never returns the bare video-analysis id when no duration is known — tier's own ceiling instead", () => {
    const node = vaNode({ llmModel: "mixed" })
    expect(getModelIdentifier(node)).toBe("video-analysis:mixed:600s")
  })

  it("prices the smart tier under its own family", () => {
    const node = vaNode({ llmModel: "smart" })
    expect(getModelIdentifier(node)).toBe("video-analysis:smart:600s")
  })

  it("trusts a YouTube probe only while it matches the current URL", () => {
    const trusted = vaNode({
      llmModel: "mixed",
      youtubeUrl: "https://youtu.be/abc",
      probedYoutube: { url: "https://youtu.be/abc", durationSec: 45 },
    })
    expect(getModelIdentifier(trusted)).toBe("video-analysis:mixed:60s")

    const stale = vaNode({
      llmModel: "mixed",
      youtubeUrl: "https://youtu.be/CHANGED",
      probedYoutube: { url: "https://youtu.be/abc", durationSec: 45 },
    })
    expect(getModelIdentifier(stale)).toBe("video-analysis:mixed:600s")
  })

  it("prices mixed-fast under the shared mixed credit family", () => {
    const node = vaNode({ llmModel: "mixed-fast" })
    expect(getModelIdentifier(node)).toBe("video-analysis:mixed:600s")
  })

  it("prices a Social Search's posts by the longest of their videos — not a probe left from an earlier wire", () => {
    const post = (n: number, durationSec: number) => ({
      id: `instagram:${n}`,
      platform: "instagram",
      url: `https://www.instagram.com/reel/D${n}/`,
      text: "",
      author: { handle: "a", name: "A" },
      metrics: {},
      media: { kind: "video", durationSec },
      hashtags: [],
      extra: {},
    })
    const node = vaNode({ llmModel: "pro", probedVideo: { url: "https://cdn.example/old.mp4", durationSec: 500 } })
    const search = { id: "search", type: "social-search", position: { x: 0, y: 0 }, data: { generatedJson: [post(1, 27), post(2, 90)] } } as unknown as WorkflowNode
    const edges = [{ id: "e", source: "search", target: "va-1", sourceHandle: "json", targetHandle: "video", data: { outputMode: "each" } }] as unknown as Parameters<typeof getModelIdentifier>[1]
    expect(getModelIdentifier(node, edges, [search, node])).toBe(buildVideoAnalysisCreditId(resolveVideoAnalysisModel("pro"), 90))
    expect(getModelIdentifier(node, edges, [search, node])).toMatch(/:180s$/)
  })

  it("agrees with the node badge for the default tier (and is never the bare id)", () => {
    const node = vaNode({})
    const id = getModelIdentifier(node)
    expect(id).toBe(buildVideoAnalysisCreditId(resolveVideoAnalysisModel(undefined), undefined))
    expect(id).not.toBe("video-analysis")
    expect(id.startsWith("video-analysis:")).toBe(true)
  })
})

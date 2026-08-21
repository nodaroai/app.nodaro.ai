/**
 * Slideshow input routing — the three lanes that must not silently break:
 *
 *   1. transition PARAMETER node → inputs.transition (VALUE routing). This is
 *      the suno-voice trap: the resolver branch exists, but if the parameter
 *      node's output extraction yields nothing, `if (!output) continue` fires
 *      BEFORE the routing branch and the pick silently degrades to cut.
 *   2. images ACCUMULATE in wire order (the image-collage lane) — direct
 *      edges and a list source under the Bundle ("all") edge mode.
 *   3. the audio handle routes to audioUrl, never into the image array.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data,
  }
}

describe("resolveNodeInputs — slideshow", () => {
  it("routes a wired transition PARAMETER node's pick into inputs.transition (not a prompt hint, not dropped)", () => {
    const target = node("show", "slideshow")
    const transition = node("tr", "transition", { transition: "cross-dissolve" })
    const states: Record<string, NodeExecutionState> = {}

    const result = resolveNodeInputs(target, [edge("tr", "show", null, "transition")], states, [transition, target])
    expect(result.transition).toBe("cross-dissolve")
  })

  it("routes the transition pick even when the edge lands on a default handle (source-type fallback)", () => {
    const target = node("show", "slideshow")
    const transition = node("tr", "transition", { transition: "fade-to-black" })
    const result = resolveNodeInputs(target, [edge("tr", "show")], {}, [transition, target])
    expect(result.transition).toBe("fade-to-black")
  })

  it("accumulates direct image edges in wire order and keeps audio out of the array", () => {
    const target = node("show", "slideshow")
    const img1 = node("i1", "upload-image", { url: "https://x/a.png" })
    const img2 = node("i2", "upload-image", { url: "https://x/b.png" })
    const audio = node("au", "upload-audio", { url: "https://x/t.mp3" })
    const edges = [
      edge("i1", "show", null, "images"),
      edge("i2", "show", null, "images"),
      edge("au", "show", null, "audio"),
    ]
    const result = resolveNodeInputs(target, edges, {}, [img1, img2, audio, target])
    expect(result.imageUrls).toEqual(["https://x/a.png", "https://x/b.png"])
    expect(result.audioUrl).toBe("https://x/t.mp3")
  })

  it("spreads a LIST source's rows into imageUrls under the Bundle (all) edge mode", () => {
    const target = node("show", "slideshow")
    const list = node("ls", "list", {})
    const states: Record<string, NodeExecutionState> = {
      ls: {
        status: "completed",
        output: { listResults: ["https://x/1.png", "https://x/2.png", "https://x/3.png"] },
      },
    }
    const result = resolveNodeInputs(
      target,
      [edge("ls", "show", null, "images", { outputMode: "all" })],
      states,
      [list, target],
    )
    expect(result.imageUrls).toEqual(["https://x/1.png", "https://x/2.png", "https://x/3.png"])
  })
})

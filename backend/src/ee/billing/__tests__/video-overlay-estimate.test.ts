// @test-units-by-name prices the node types it names (video-overlay, upload-video, upload-image, list, text, ugc-cards)
// @test-watches backend/src/lib/tutorial-seed/templates/ugc-*.json
/**
 * The server's run estimate of a Video Overlay (apps, templates, MCP) is the
 * price its run is charged, or above it — never below. An image-only node is
 * the flat row; a node that can carry a video layer is the video row per
 * started 5 s of its base, and a base not known before the run is quoted at
 * the 60 s cap. Base credits (`STATIC_CREDIT_COSTS`, no markup).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

type N = { id: string; type: string; data: Record<string, unknown> }
const overlay = (data: Record<string, unknown>): N => ({ id: "x", type: "video-overlay", data })
const base = (duration?: number): N => ({ id: "b", type: "upload-video", data: { url: "https://m.test/b.mp4", ...(duration === undefined ? {} : { duration }) } })
const wire = (source: string, targetHandle: string) => ({ source, target: "x", targetHandle })
const estimate = (nodes: N[], edges: Array<{ source: string; target: string; targetHandle: string }>) => CreditsService.estimateWorkflowBaseCredits(nodes, edges)

const IMAGE_ROW = STATIC_CREDIT_COSTS["video-overlay"]!
const VIDEO_ROW = STATIC_CREDIT_COSTS["video-overlay:video"]!

describe("the server's run estimate of a Video Overlay", () => {
  it("the rows: the flat image row, and the video row per 5 s", () => {
    expect(IMAGE_ROW).toBe(20)
    expect(VIDEO_ROW).toBe(10)
  })

  it("an image-only node is the flat row, whatever its base's length", () => {
    expect(estimate([overlay({ layers: [{ imageUrl: "https://m.test/a.png", start: 0 }] }), base(600)], [wire("b", "video")])).toBe(IMAGE_ROW)
  })

  it("a stored video layer on a 15 s base: 3 units", () => {
    expect(estimate([overlay({ layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] }), base(15)], [wire("b", "video")])).toBe(3 * VIDEO_ROW)
  })

  it("a video wired to a layer handle on a 23 s base: 5 units", () => {
    const clip: N = { id: "c", type: "upload-video", data: { url: "https://m.test/c.mp4", duration: 60 } }
    expect(estimate([overlay({ layers: [{ start: 0 }] }), base(23), clip], [wire("b", "video"), wire("c", "overlay")])).toBe(5 * VIDEO_ROW)
  })

  it("a base whose length is not known yet is quoted at the 60 s cap: 12 units", () => {
    expect(estimate([overlay({ layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] }), base()], [wire("b", "video")])).toBe(12 * VIDEO_ROW)
    expect(estimate([overlay({ layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] })], [])).toBe(12 * VIDEO_ROW)
  })

  it("an upload whose current url matches no saved result, with a stale stored length: the cap (the editor quotes the same)", () => {
    const stale: N = { id: "b", type: "upload-video", data: { url: "https://m.test/new.mp4", videoDurationSec: 10, generatedResults: [{ url: "https://m.test/old.mp4", duration: 10 }] } }
    expect(estimate([overlay({ layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] }), stale], [wire("b", "video")])).toBe(12 * VIDEO_ROW)
  })

  it("a base past the cap is quoted at the cap (the run refuses it before charging)", () => {
    expect(estimate([overlay({ layers: [{ videoUrl: "https://m.test/c.mp4", start: 0 }] }), base(300)], [wire("b", "video")])).toBe(12 * VIDEO_ROW)
  })

  it("a layerPlan wire whose layers are not known before the run (a Text node) is quoted as a video run", () => {
    const text: N = { id: "p", type: "text", data: { text: "[]" } }
    expect(estimate([overlay({ layers: [] }), base(15), text], [wire("b", "video"), wire("p", "layerPlan")])).toBe(3 * VIDEO_ROW)
    expect(estimate([overlay({ layers: [] }), base(), text], [wire("b", "video"), wire("p", "layerPlan")])).toBe(12 * VIDEO_ROW)
  })

  it("UGC Cards' layer plan is its card images: the flat row", () => {
    const cards: N = { id: "p", type: "ugc-cards", data: {} }
    expect(estimate([overlay({ layers: [] }), base(), cards], [wire("b", "video"), { source: "p", target: "x", targetHandle: "layerPlan", sourceHandle: "layerPlan" } as never])).toBe(IMAGE_ROW)
  })

  it("a List on a layer handle: images known before the run are the flat row; videos, or cells not known yet, the video row", () => {
    const images: N = { id: "l", type: "list", data: { columns: [{ id: "c", handleId: "c", type: "text" }], rows: [["https://m.test/a.png"], ["https://m.test/b.jpg"]] } }
    // Two items: the List runs the node once per item, each on the flat row.
    expect(estimate([overlay({ layers: [{ start: 0 }] }), base(15), images], [wire("b", "video"), wire("l", "overlay")])).toBe(2 * IMAGE_ROW)
    const videos: N = { id: "l", type: "list", data: { columns: [{ id: "c", handleId: "c", type: "video-url" }], rows: [] } }
    expect(estimate([overlay({ layers: [{ start: 0 }] }), base(), videos], [wire("b", "video"), wire("l", "overlay")])).toBe(12 * VIDEO_ROW)
    const empty: N = { id: "l", type: "list", data: { items: "" } }
    expect(estimate([overlay({ layers: [{ start: 0 }] }), base(15), empty], [wire("b", "video"), wire("l", "overlay")])).toBe(3 * VIDEO_ROW)
  })

  it("an image wired to a layer handle keeps the flat row", () => {
    const image: N = { id: "i", type: "upload-image", data: { url: "https://m.test/a.png" } }
    expect(estimate([overlay({ layers: [{ start: 0 }] }), base(10), image], [wire("b", "video"), wire("i", "overlay")])).toBe(IMAGE_ROW)
  })
})

describe("the built-in UGC templates", () => {
  // Their Video Overlay takes UGC Cards' plan (card images): quoted on the flat
  // row, exactly as before video layers existed.
  it.each(["ugc-app-demo", "ugc-product-in-hand", "ugc-website-video", "ugc-website-video-he"])("%s: its Video Overlay is quoted on the flat image row", (name) => {
    const doc = JSON.parse(readFileSync(join(__dirname, "../../../lib/tutorial-seed/templates", `${name}.json`), "utf8")) as { workflow?: { nodes: N[]; edges: never[] }; nodes?: N[]; edges?: never[] }
    const wf = doc.workflow ?? (doc as { nodes: N[]; edges: never[] })
    const overlays = wf.nodes.filter((n) => n.type === "video-overlay")
    expect(overlays.length).toBeGreaterThan(0)
    expect(CreditsService.estimateWorkflowBaseCredits(wf.nodes, wf.edges, { runNodeIds: new Set(overlays.map((n) => n.id)) })).toBe(overlays.length * IMAGE_ROW)
  })
})

import { describe, it, expect } from "vitest"
import { expandVideoOverlayLayer } from "@nodaro/shared"
import { deltaTouchesVideoOverlay, videoOverlayDeltaUpserts } from "../video-overlay-delta.js"

const OWN = "https://r2.test/own.png"
const STALE = "https://r2.test/stale.png"
const vo = (layers: unknown[]) => ({ id: "vo", type: "video-overlay", position: { x: 400, y: 0 }, data: { label: "Video Overlay", layers } })
const wire = (handle: string) => ({ id: `e-${handle}`, source: "img", sourceHandle: "image", target: "vo", targetHandle: handle })

describe("deltaTouchesVideoOverlay — which delta saves pay for the stored-graph read", () => {
  it("an upserted video-overlay node, or an upserted edge into a layer handle — nothing else", () => {
    expect(deltaTouchesVideoOverlay({ upsertEdges: [wire("overlay3")] })).toBe(true)
    expect(deltaTouchesVideoOverlay({ upsertNodes: [vo([])] })).toBe(true)
    expect(
      deltaTouchesVideoOverlay({
        upsertNodes: [{ id: "t", type: "text-prompt", data: {} }],
        upsertEdges: [{ id: "e", target: "g", targetHandle: "prompt" }],
      }),
    ).toBe(false)
    expect(deltaTouchesVideoOverlay({})).toBe(false)
  })
})

describe("videoOverlayDeltaUpserts — D10 on the delta save", () => {
  it("an edge-only delta pulls the stored node it wires into the upserts, that layer's imageUrl cleared, its position kept", () => {
    const stored = [
      { id: "img", type: "upload-image", data: { url: "https://r2.test/wired.png" } },
      vo([{ imageUrl: STALE, start: 1, preset: "card" }, { imageUrl: OWN, start: 2 }]),
    ]
    const out = videoOverlayDeltaUpserts({ upsertEdges: [wire("overlay")] }, stored, [wire("overlay")])
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe("vo")
    expect(out[0]!.position).toEqual({ x: 400, y: 0 })
    const layers = (out[0]!.data as { layers: unknown[] }).layers
    expect(layers[0]).toEqual(expandVideoOverlayLayer({ start: 1, preset: "card" }))
    expect(layers[1]).toEqual(expandVideoOverlayLayer({ imageUrl: OWN, start: 2 }))
  })

  it("normalises the delta's OWN video-overlay upsert against the edges the save leaves behind (stored ones included)", () => {
    const out = videoOverlayDeltaUpserts({ upsertNodes: [vo([{ imageUrl: STALE, start: 0 }])] }, [], [wire("overlay")])
    expect((out[0]!.data as { layers: Array<Record<string, unknown>> }).layers[0]).not.toHaveProperty("imageUrl")
  })

  it("returns the delta's upserts BY REFERENCE when nothing changes, and never pulls in a node the delta deletes", () => {
    const clean = vo([expandVideoOverlayLayer({ imageUrl: OWN, start: 2 })])
    const delta = { upsertNodes: [{ id: "t", type: "text-prompt", data: {} }] }
    expect(videoOverlayDeltaUpserts(delta, [clean], [])).toBe(delta.upsertNodes)
    const stale = vo([{ imageUrl: STALE, start: 1 }])
    expect(videoOverlayDeltaUpserts({ deleteNodeIds: ["vo"], upsertEdges: [wire("overlay")] }, [stale], [wire("overlay")])).toEqual([])
  })
})

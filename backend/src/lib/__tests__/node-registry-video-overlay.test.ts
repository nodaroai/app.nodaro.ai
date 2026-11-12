// @test-units-by-name looks up only the video-overlay entry of NODE_REGISTRY
import { describe, it, expect } from "vitest"
import { VIDEO_OVERLAY_FITS, VIDEO_OVERLAY_LAYOUT_IDS, VIDEO_OVERLAY_OUTPUT_ASPECTS } from "@nodaro/shared/video"
import { NODE_REGISTRY } from "../node-registry.js"

describe("the Video Overlay node's discovery entry (GET /v1/nodes)", () => {
  const entry = NODE_REGISTRY.find((n) => n.type === "video-overlay")
  const fields = entry?.inputSchema?.fields ?? []

  it("lists the request fields POST /v1/video-overlay accepts — the base box and the layout included — and no other", () => {
    expect(fields.map((f) => f.key)).toEqual(["videoUrl", "layers", "outputAspect", "baseFit", "backgroundColor", "baseBox", "layout"])
  })

  it("offers the shared vocabularies as options", () => {
    const options = (key: string) => fields.find((f) => f.key === key)?.options
    expect(options("outputAspect")).toEqual([...VIDEO_OVERLAY_OUTPUT_ASPECTS])
    expect(options("baseFit")).toEqual([...VIDEO_OVERLAY_FITS])
    expect(options("layout")).toEqual([...VIDEO_OVERLAY_LAYOUT_IDS])
    expect(fields.find((f) => f.key === "baseBox")).toEqual({ key: "baseBox", type: "json" })
  })

  it("describes a layer's video source and its sound by the route's own key names", () => {
    expect(entry?.description).toContain("videoUrl")
    expect(entry?.description).toContain("sound.volume")
    expect(entry?.description).toContain("baseBox")
    expect(entry?.description).toContain("layout")
  })
})

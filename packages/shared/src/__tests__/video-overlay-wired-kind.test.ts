/**
 * What a source wired to a Video Overlay layer handle draws as — the ONE rule
 * both engines call (`videoOverlayWiredLayerKind`), step by step:
 *   1. the medium the wire is known to carry: a pip row of its own, a declared
 *      port medium, or the source's effective type for that handle;
 *   2. the producer sets, for a single-medium producer only;
 *   3. the URL path's extension;
 *   4. an image.
 */
import { describe, it, expect } from "vitest"
import { declaredOutputMediaType, listColumnMediaType, videoOverlayWireMediumBeforeRun as beforeRun, videoOverlayWiredLayerKind as kind } from "../video-overlay-video-layers.js"
import { DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "../producer-types.js"

const NO_EXT = "https://cdn.example/signed/abc?token=1"
const MP4 = "https://cdn.example/a.mp4"
const PNG = "https://cdn.example/a.png"

describe("videoOverlayWiredLayerKind — 1. the medium the wire is known to carry", () => {
  it("3D Render Pro: its stills pip is an image, its video pip a video — whatever the URL says", () => {
    expect(kind({ type: "pro-3d-render", handle: "stills" }, MP4)).toBe("image")
    expect(kind({ type: "pro-3d-render", handle: "stills" }, NO_EXT)).toBe("image")
    expect(kind({ type: "pro-3d-render", handle: "video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "pro-3d-render", handle: "video" }, PNG)).toBe("video")
  })

  it("a dynamic producer's video pip is a video, whatever its file is named; its other pips follow the file", () => {
    const videoPips = [
      ["adjust-volume", "video-out"], ["pitch-tempo", "video-out"], ["voice-changer", "video"],
      ["voice-changer-pro", "video"], ["dubbing", "video"], ["split-media", "video"],
    ] as const
    for (const [type, handle] of videoPips) {
      expect(DYNAMIC_PRODUCER_TYPES.has(type)).toBe(true)
      expect(kind({ type, handle }, NO_EXT)).toBe("video")
      expect(kind({ type, handle }, MP4)).toBe("video")
    }
    expect(kind({ type: "adjust-volume", handle: "audio-out" }, NO_EXT)).toBe("image")
    expect(kind({ type: "dubbing", handle: "audio" }, MP4)).toBe("video")
  })

  it("a declared port medium (a component's or sub-workflow's) decides, before the URL", () => {
    expect(kind({ type: "component", handle: "out_clip", declaredMediaType: "video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "sub-workflow", handle: "out_p", declaredMediaType: "video" }, PNG)).toBe("video")
    expect(kind({ type: "sub-workflow", handle: "out_p", declaredMediaType: "image" }, MP4)).toBe("image")
  })

  it("a declared medium that is neither (audio, text, any) decides nothing", () => {
    expect(kind({ type: "sub-workflow", handle: "out_p", declaredMediaType: "any" }, MP4)).toBe("video")
    expect(kind({ type: "sub-workflow", handle: "out_p", declaredMediaType: "audio" }, NO_EXT)).toBe("image")
  })

  it("an aggregate lane carries its lane's medium", () => {
    expect(kind({ type: "collect", handle: "out-video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "group", handle: "out-video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "collect", handle: "out-image" }, MP4)).toBe("image")
  })

  it("a scraper's typed pips, an entity's image pip and an image output pip carry their medium", () => {
    expect(kind({ type: "meta-ads-scrape", handle: "video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "instagram-scrape", handle: "image" }, MP4)).toBe("image")
    expect(kind({ type: "character", handle: "image" }, MP4)).toBe("image")
    expect(kind({ type: "ugc-creator", handle: "image" }, MP4)).toBe("image")
  })
})

describe("videoOverlayWiredLayerKind — 2. a single-medium producer", () => {
  it("a video producer is a video, an image producer an image", () => {
    expect(kind({ type: "generate-video" }, NO_EXT)).toBe("video")
    expect(kind({ type: "upload-video", handle: "video" }, PNG)).toBe("video")
    expect(kind({ type: "generate-image" }, MP4)).toBe("image")
  })

  it("a producer in both sets decides nothing on a pip with no row of its own: the URL does", () => {
    const both = [...VIDEO_PRODUCER_TYPES].filter((t) => IMAGE_PRODUCER_TYPES.has(t))
    expect(both).toContain("pro-3d-render")
    for (const type of both) {
      expect(kind({ type, handle: "composition" }, MP4)).toBe("video")
      expect(kind({ type }, PNG)).toBe("image")
    }
  })

  it("a dynamic producer decides nothing: the URL does", () => {
    for (const type of DYNAMIC_PRODUCER_TYPES) {
      expect(kind({ type }, MP4)).toBe("video")
      expect(kind({ type }, NO_EXT)).toBe("image")
    }
  })
})

describe("videoOverlayWiredLayerKind — 3. the URL, then 4. an image", () => {
  it("a source of no known kind reads by its path, and is an image otherwise", () => {
    expect(kind({ type: "some-future-node", handle: "out" }, "https://x/a.webm?sig=1")).toBe("video")
    expect(kind({ type: "some-future-node" }, NO_EXT)).toBe("image")
    expect(kind({}, NO_EXT)).toBe("image")
    expect(kind({ type: null, handle: null, declaredMediaType: null }, MP4)).toBe("video")
  })
})

describe("declaredOutputMediaType — the medium a component / sub-workflow port declares", () => {
  it("a sub-workflow's output port, by `out_<port>`", () => {
    const data = { routeSnapshot: { outputPorts: [{ id: "p1", mediaType: "video" }, { id: "p2", mediaType: "image" }] } }
    expect(declaredOutputMediaType("sub-workflow", data, "out_p1")).toBe("video")
    expect(declaredOutputMediaType("sub-workflow", data, "out_p2")).toBe("image")
    expect(declaredOutputMediaType("sub-workflow", data, "out_p3")).toBeUndefined()
  })

  it("a component's output, from its route snapshot, else its metadata", () => {
    const meta = { componentMetadata: { outputs: [{ id: "clip", type: "video" }] } }
    expect(declaredOutputMediaType("component", meta, "out_clip")).toBe("video")
    expect(declaredOutputMediaType("component", { ...meta, routeSnapshot: { outputPorts: [{ id: "clip", mediaType: "image" }] } }, "out_clip")).toBe("image")
  })

  it("a sub-workflow input port, by its own id", () => {
    expect(declaredOutputMediaType("sub-workflow-input", { ports: [{ id: "in1", mediaType: "video" }] }, "in1")).toBe("video")
  })

  it("a List's column type is not a port declaration", () => {
    expect(declaredOutputMediaType("list", { columns: [{ handleId: "c", type: "video-url" }] }, "c")).toBeUndefined()
  })

  it("anything else, or malformed data, declares nothing", () => {
    expect(declaredOutputMediaType("generate-video", { routeSnapshot: { outputPorts: [{ id: "p", mediaType: "video" }] } }, "out_p")).toBeUndefined()
    expect(declaredOutputMediaType("sub-workflow", { routeSnapshot: { outputPorts: [{ id: "p", mediaType: "video" }] } }, null)).toBeUndefined()
    expect(declaredOutputMediaType("sub-workflow", { routeSnapshot: { outputPorts: "p" } }, "out_p")).toBeUndefined()
    expect(declaredOutputMediaType("sub-workflow", { routeSnapshot: { outputPorts: [null, 7, { id: "p", mediaType: 3 }] } }, "out_p")).toBeUndefined()
    expect(declaredOutputMediaType("component", null, "out_p")).toBeUndefined()
    expect(declaredOutputMediaType(undefined, {}, "out_p")).toBeUndefined()
  })
})

describe("listColumnMediaType — what a List column's type declares", () => {
  it("the column the pip names, else the first (the one a List's own `list` pip carries)", () => {
    const data = { columns: [{ id: "a", handleId: "col_a", type: "image-url" }, { id: "b", handleId: "col_b", type: "video-url" }, { id: "c", handleId: "col_c", type: "text" }] }
    expect(listColumnMediaType("list", data, "col_a")).toBe("image")
    expect(listColumnMediaType("list", data, "col_b")).toBe("video")
    expect(listColumnMediaType("list", data, "list")).toBe("image")
    expect(listColumnMediaType("list", data, "col_c")).toBeUndefined()
    expect(listColumnMediaType("list", { columns: [{ handleId: "x", type: "audio-url" }] }, "x")).toBe("audio")
  })
  it("nothing for another source, legacy items, or malformed data", () => {
    expect(listColumnMediaType("sub-workflow", { columns: [{ handleId: "x", type: "video-url" }] }, "x")).toBeUndefined()
    expect(listColumnMediaType("list", { items: "https://x/a.mp4" }, "list")).toBeUndefined()
    expect(listColumnMediaType("list", { columns: "image-url" }, "list")).toBeUndefined()
    expect(listColumnMediaType("list", null, "list")).toBeUndefined()
  })
})

describe("videoOverlayWiredLayerKind — a List column's type ranks below the URL's extension", () => {
  const videoColumn = { type: "list", handle: "list", columnMediaType: "video" }
  const imageColumn = { type: "list", handle: "list", columnMediaType: "image" }
  it("a recognisable extension wins: a .png in a video-url column is an image, an .mp4 in an image-url column a video", () => {
    expect(kind(videoColumn, PNG)).toBe("image")
    expect(kind(videoColumn, "https://x/a.JPG?sig=1")).toBe("image")
    expect(kind(imageColumn, MP4)).toBe("video")
  })
  it("the column type fills the gap for a link with no recognisable extension", () => {
    expect(kind(videoColumn, NO_EXT)).toBe("video")
    expect(kind(imageColumn, NO_EXT)).toBe("image")
    expect(kind({ type: "list", handle: "list", columnMediaType: "audio" }, NO_EXT)).toBe("image")
  })
  it("a producer, a pip row or a declared port still decides before the file", () => {
    expect(kind({ type: "upload-image", columnMediaType: "video" }, NO_EXT)).toBe("image")
    expect(kind({ type: "sub-workflow", handle: "out_p", declaredMediaType: "image", columnMediaType: "video" }, MP4)).toBe("image")
  })
})

describe("videoOverlayWireMediumBeforeRun — what a wire hands a Video Overlay, as far as it is known before the run", () => {
  it("a layer wire whose source decides by itself: the producer, a pip row, a declared port", () => {
    expect(beforeRun({ type: "upload-video" })).toBe("video")
    expect(beforeRun({ type: "upload-image" })).toBe("image")
    expect(beforeRun({ type: "pro-3d-render", handle: "stills" })).toBe("image")
    expect(beforeRun({ type: "sub-workflow", handle: "out_p", declaredMediaType: "video" })).toBe("video")
  })

  it("a layer wire whose kind follows its file: the known files decide (extension, then column type), else it is not known", () => {
    expect(beforeRun({ type: "list", handle: "list" })).toBe("unknown")
    // A declared column type alone does not decide: an extension in a cell outranks it.
    expect(beforeRun({ type: "list", handle: "list", columnMediaType: "image" })).toBe("unknown")
    expect(beforeRun({ type: "list", handle: "list" }, { knownUrls: [PNG, "https://x/b.jpg"] })).toBe("image")
    expect(beforeRun({ type: "list", handle: "list" }, { knownUrls: [PNG, MP4] })).toBe("video")
    expect(beforeRun({ type: "list", handle: "list", columnMediaType: "video" }, { knownUrls: [PNG] })).toBe("image")
    expect(beforeRun({ type: "list", handle: "list", columnMediaType: "video" }, { knownUrls: [NO_EXT] })).toBe("video")
    expect(beforeRun({ type: "text", handle: "text" })).toBe("unknown")
    expect(beforeRun({ type: "sub-workflow", handle: "out_p" })).toBe("unknown")
  })

  it("never disagrees with the run's rule once the file is known", () => {
    const sources = [
      { type: "list" }, { type: "list", columnMediaType: "video" }, { type: "list", columnMediaType: "image" },
      { type: "upload-image" }, { type: "upload-video" }, { type: "pro-3d-render", handle: "video" },
    ]
    for (const source of sources) {
      for (const url of [PNG, MP4, NO_EXT]) expect(beforeRun(source, { knownUrls: [url] })).toBe(kind(source, url))
    }
  })

  it("on the plan handle only a plan pip row answers image: UGC Cards' plan is its card images", () => {
    expect(beforeRun({ type: "ugc-cards", handle: "layerPlan" }, { target: "plan" })).toBe("image")
    expect(beforeRun({ type: "ugc-cards", handle: "captionPlan" }, { target: "plan" })).toBe("unknown")
    // A declared image port, an image producer, an image List column, a layer pip row: what a FILE is, not a plan's layers.
    expect(beforeRun({ type: "sub-workflow", handle: "out_p", declaredMediaType: "image" }, { target: "plan" })).toBe("unknown")
    expect(beforeRun({ type: "upload-image" }, { target: "plan" })).toBe("unknown")
    expect(beforeRun({ type: "list", handle: "list", columnMediaType: "image" }, { target: "plan", knownUrls: [PNG] })).toBe("unknown")
    expect(beforeRun({ type: "pro-3d-render", handle: "stills" }, { target: "plan" })).toBe("unknown")
    expect(beforeRun({ type: "text", handle: "text" }, { target: "plan" })).toBe("unknown")
    expect(beforeRun({ type: "upload-video" }, { target: "plan" })).toBe("video")
  })
})

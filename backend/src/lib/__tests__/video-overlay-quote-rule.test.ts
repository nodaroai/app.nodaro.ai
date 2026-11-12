/**
 * The one rule a run estimate prices a Video Overlay by (@nodaro/render-rules,
 * read by the server's run estimate and the editor's): the video row whenever
 * the run can carry a video layer, else the flat image row; the base length
 * from its `video` wire, at most the cap.
 */
import { describe, it, expect } from "vitest"
import { videoOverlayBaseSec, videoOverlayBaseWireSec, videoOverlayQuotesVideo } from "@nodaro/render-rules"

const node = (data: Record<string, unknown> = {}) => ({ id: "x", type: "video-overlay", data })
const upload = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const wire = (source: string, targetHandle: string, sourceHandle?: string) => ({ source, target: "x", targetHandle, ...(sourceHandle ? { sourceHandle } : {}) })

describe("videoOverlayQuotesVideo — is a run estimate priced on the video row?", () => {
  const base = upload("b", "upload-video")

  it("an image-only node — stored images, a wired image — is the flat image row", () => {
    const x = node({ layers: [{ imageUrl: "https://m.test/a.png", start: 0 }, { start: 0 }] })
    const nodes = [x, base, upload("i", "upload-image")]
    expect(videoOverlayQuotesVideo(x, nodes, [wire("b", "video"), wire("i", "overlay2")])).toBe(false)
  })

  it("a stored videoUrl on a slot nothing is wired to is a video layer", () => {
    const x = node({ layers: [{ videoUrl: "https://m.test/v.mp4", start: 0 }] })
    expect(videoOverlayQuotesVideo(x, [x, base], [wire("b", "video")])).toBe(true)
  })

  it("a stored videoUrl on a slot a wired image replaces is not", () => {
    const x = node({ layers: [{ videoUrl: "https://m.test/v.mp4", start: 0 }] })
    expect(videoOverlayQuotesVideo(x, [x, base, upload("i", "upload-image")], [wire("b", "video"), wire("i", "overlay")])).toBe(false)
  })

  it("a video wired to a layer handle is a video layer", () => {
    const x = node({ layers: [{ start: 0 }] })
    expect(videoOverlayQuotesVideo(x, [x, base, upload("c", "upload-video")], [wire("b", "video"), wire("c", "overlay")])).toBe(true)
  })

  it("a video wired to a layer handle through a teleport is still a video layer", () => {
    const x = node({ layers: [{ start: 0 }] })
    const nodes = [x, base, upload("c", "upload-video"), upload("ts", "teleport-send"), upload("tr", "teleport-receive")]
    const edges = [wire("b", "video"), { source: "c", target: "ts", sourceHandle: "video" }, { source: "ts", target: "tr" }, wire("tr", "overlay")]
    expect(videoOverlayQuotesVideo(x, nodes, edges)).toBe(true)
  })

  describe("a List on a layer handle: what is known before the run decides", () => {
    const x = node({ layers: [{ start: 0 }] })
    const quotes = (list: Record<string, unknown>, extraEdges: Array<Record<string, unknown>> = []) =>
      videoOverlayQuotesVideo(x, [x, base, upload("l", "list", list), upload("u", "upload-image")], [wire("b", "video"), wire("l", "overlay", "list"), ...(extraEdges as never[])])

    it("a cell's recognisable extension outranks the column's type: a .png in a video-url column is an image, an .mp4 in an image-url column a video", () => {
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "video-url" }], rows: [["https://m.test/a.png"]] })).toBe(false)
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "image-url" }], rows: [["https://m.test/a.mp4"]] })).toBe(true)
    })

    it("the column's type fills the gap for a cell with no recognisable extension", () => {
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "image-url" }], rows: [["https://m.test/signed/a?sig=1"]] })).toBe(false)
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "video-url" }], rows: [["https://m.test/signed/a?sig=1"]] })).toBe(true)
      // A text column of such cells: an image, as before video layers.
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "text" }], rows: [["https://m.test/signed/a?sig=1"]] })).toBe(false)
    })

    it("a text column of literal URLs reads them: all images is the image row, any video the video row", () => {
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "text" }], rows: [["https://m.test/a.png"], ["https://m.test/b.jpg"]] })).toBe(false)
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "text" }], rows: [["https://m.test/a.png"], ["https://m.test/b.mp4"]] })).toBe(true)
      expect(quotes({ items: "https://m.test/a.png\nhttps://m.test/b.webp" })).toBe(false)
      expect(quotes({ items: "https://m.test/a.png\nhttps://m.test/b.mov" })).toBe(true)
    })

    it("a List whose cells are not known before the run (wired, or empty) is quoted as a video run", () => {
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "text" }], rows: [["https://m.test/a.png"]] }, [{ source: "u", target: "l", targetHandle: "c_in" }])).toBe(true)
      expect(quotes({ columns: [{ id: "c", handleId: "c", type: "text" }], rows: [] })).toBe(true)
    })
  })

  it("UGC Cards' layer plan is its card images: the image row", () => {
    const x = node({ layers: [] })
    expect(videoOverlayQuotesVideo(x, [x, base, upload("p", "ugc-cards")], [wire("b", "video"), wire("p", "layerPlan", "layerPlan")])).toBe(false)
  })

  it("on the plan handle a declared image port, an image producer or an image List column does not make the plan image-only", () => {
    const x = node({ layers: [] })
    const sub = upload("p", "sub-workflow", { routeSnapshot: { outputPorts: [{ id: "plan", mediaType: "image" }] } })
    expect(videoOverlayQuotesVideo(x, [x, base, sub], [wire("b", "video"), wire("p", "layerPlan", "out_plan")])).toBe(true)
    expect(videoOverlayQuotesVideo(x, [x, base, upload("p", "upload-image")], [wire("b", "video"), wire("p", "layerPlan")])).toBe(true)
    const list = upload("p", "list", { columns: [{ id: "c", handleId: "c", type: "image-url" }], rows: [["https://m.test/a.png"]] })
    expect(videoOverlayQuotesVideo(x, [x, base, list], [wire("b", "video"), wire("p", "layerPlan", "c")])).toBe(true)
  })

  it("a layerPlan wire whose layers are not known before the run (a Text node, an LLM, a List of plan text) counts as a video", () => {
    const x = node({ layers: [] })
    expect(videoOverlayQuotesVideo(x, [x, base, upload("p", "text")], [wire("b", "video"), wire("p", "layerPlan")])).toBe(true)
    const plans = upload("p", "list", { columns: [{ id: "c", handleId: "c", type: "text" }], rows: [['[{"imageUrl":"https://m.test/a.png","start":0}]']] })
    expect(videoOverlayQuotesVideo(x, [x, base, plans], [wire("b", "video"), wire("p", "layerPlan", "list")])).toBe(true)
  })

  it("the base wire alone (a video) is never a video LAYER", () => {
    const x = node({ layers: [{ imageUrl: "https://m.test/a.png", start: 0 }] })
    expect(videoOverlayQuotesVideo(x, [x, base], [wire("b", "video")])).toBe(false)
  })

  it("untrusted layer entries read as no layer", () => {
    const x = node({ layers: ["https://m.test/v.mp4", 7, null, ["videoUrl"]] })
    expect(videoOverlayQuotesVideo(x, [x, base], [wire("b", "video")])).toBe(false)
  })
})

describe("videoOverlayBaseSec — the base length a run estimate prices", () => {
  it("is the video wire's length", () => {
    expect(videoOverlayBaseSec([{ targetHandle: "overlay" }, { targetHandle: "video" }], [99, 23])).toBe(23)
  })
  it("is at most the 60 s cap", () => {
    expect(videoOverlayBaseSec([{ targetHandle: "video" }], [300])).toBe(60)
  })
  it("reads the same wire as videoOverlayBaseWireSec, the editor's cap warning, which is not capped", () => {
    expect(videoOverlayBaseWireSec([{ targetHandle: "video" }], [300])).toBe(300)
    expect(videoOverlayBaseWireSec([{ targetHandle: "overlay" }, { targetHandle: "layerPlan" }, { targetHandle: null }], [5, 6, 31])).toBe(31)
    expect(videoOverlayBaseWireSec([{ targetHandle: "video" }], [undefined])).toBeUndefined()
  })
  it("reads the one wire on no layer or plan handle when there is no video wire (the base the resolvers fill from it)", () => {
    expect(videoOverlayBaseSec([{ targetHandle: "overlay" }, { targetHandle: "layerPlan" }, { targetHandle: null }], [5, 6, 31])).toBe(31)
  })
  it("is undefined when not known — the cap is quoted", () => {
    expect(videoOverlayBaseSec([{ targetHandle: "video" }], [undefined])).toBeUndefined()
    expect(videoOverlayBaseSec([], [])).toBeUndefined()
  })
})

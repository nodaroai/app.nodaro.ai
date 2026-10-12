/**
 * What anyone but its author receives of a graph holding a UGC video
 * (`stripUgcPublishState`, @nodaro/render-rules). Nothing made from a UGC run
 * ships, and never the author's photo:
 * - every UGC node starts empty;
 * - every node downstream of a UGC node — over its wires, a teleport's channel, a
 *   Group it sits in, a field mapping, a Preview's items, a fan-out's clones —
 *   loses what its runs left (the video's own join, overlay and captions, and any
 *   render made from them or from the creator's image);
 * - every node whose value can flow into a UGC Creator's photo input (the photo influence set)
 *   loses its stored value: an Upload Image wired into it ships empty.
 * Every other node keeps what it holds. The URLs and text are placeholders.
 */
import { describe, expect, it } from "vitest"
import { stripUgcPublishState, ugcPhotoValueKey, ugcStripSet, ugcComposedOf, ugcComposedKey } from "@nodaro/render-rules"

type N = { id: string; type: string; parentId?: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle: string }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null): E => ({ source, target, targetHandle, sourceHandle })

const PHOTO = "https://cdn.example/author-face.png"
const PHOTO_THUMB = "https://cdn.example/author-face-thumb.png"
const PHOTO_FILE = "author-headshot.png"
const TAKE = "https://cdn.example/take.mp4"
const JOINED = "https://cdn.example/joined.mp4"
const CARDED = "https://cdn.example/carded.mp4"
const CAPTIONED = "https://cdn.example/captioned.mp4"
const NOTES = "Clip 2 ran long."
const OUTRO = "https://cdn.example/outro.mp4"
const UPSCALED = "https://cdn.example/upscaled-face.png"
const TELEPORTED = "https://cdn.example/teleported-face.png"
const WRITTEN = "A caption written from the notes."
const NESTED = "https://cdn.example/nested-out.mp4"
const ROW = "https://cdn.example/row-0.png"
const OUTSIDE = "https://cdn.example/outside.mp4"
const SCREENSHOT = "https://cdn.example/screenshot-1.png"
const STAMP = { resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-09T09:00:40.000Z" }

/** A video result as every video node holds one: the take, its row, the stamp. */
const rendered = (url: string, key = "generatedVideoUrl") => ({
  [key]: url,
  generatedResults: [{ url, jobId: "job-1", timestamp: "2026-10-09T09:00:40.000Z", thumbnailUrl: `${url}.jpg` }],
  activeResultIndex: 0,
  executionStatus: "completed",
  ...STAMP,
})

/** The author's photo as the editor stores an upload of it. */
const uploadedPhoto = () => ({
  assetId: "asset-author", url: PHOTO, r2Url: PHOTO, thumbnailUrl: PHOTO_THUMB, filename: PHOTO_FILE, fileSize: 1234, mimeType: "image/png",
  externalUrl: "", metadata: { width: 800, height: 800, format: "png" }, moderationStatus: "ok",
  generatedResults: [{ url: PHOTO, jobId: "upload-1", timestamp: "2026-10-09T09:00:00.000Z", thumbnailUrl: PHOTO_THUMB }], activeResultIndex: 0,
})

/** The template's UGC video after a My photo run, with nodes made from it and nodes outside it. */
function ranGraph(): { nodes: N[]; edges: E[] } {
  const nodes: N[] = [
    n("site", "text-prompt", { text: "Acme" }),
    n("shot1", "upload-image", { url: SCREENSHOT, r2Url: SCREENSHOT, assetId: "asset-shot" }),
    n("photo", "upload-image", { presentationInput: false, ...uploadedPhoto() }),
    n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h" } }, ugcOutputs: { plan: '{"v":1}' }, executionStatus: "completed", ...STAMP }),
    n("creator", "ugc-creator", {
      source: "photo", gender: "man", photoUrl: PHOTO, keepResult: true, generatedImageUrl: PHOTO,
      ugcOutputs: { creator: '{"v":1}', image: PHOTO }, result: { v: 1, identityImages: [PHOTO] }, executionStatus: "completed", ...STAMP,
    }),
    n("clips", "ugc-clips", { voiceId: "placeholder-voice", result: { tickets: ["{}"] }, ugcOutputs: { clips: "[]" }, __listResults: ["{}"], quote: { lines: [] }, ...STAMP }),
    n("clip", "ugc-clip", {
      ...rendered(TAKE), rerender: { "2": true }, rerenderPending: { "2": true }, __listResults: [TAKE], __listResultMeta: [{ warnings: [] }],
      clipWarnings: [], durationSec: 7, ugcOutputs: { "video-out": TAKE }, thumbnailUrl: `${TAKE}.jpg`,
    }),
    n("cards", "ugc-cards", { result: { layerPlan: "[]", captionPlan: "{}", report: NOTES }, ugcOutputs: { report: NOTES }, generatedText: NOTES, text: NOTES, ...STAMP }),
    n("join", "combine-videos", { transition: "cut", audioMode: "keep", smartCutEnabled: false, ...rendered(JOINED) }),
    n("overlay", "video-overlay", { layers: [{ imageUrl: "https://cdn.example/logo.png" }], layerCount: 1, ...rendered(CARDED), warnings: ["w"], width: 720, height: 1280, durationSec: 15, resultCompositionKey: "k" }),
    n("captions", "add-captions", { style: "body", fontSize: 48, ...rendered(CAPTIONED) }),
    // Made from the video: an outro join after the captions, an upscale of the creator's image,
    // a Preview of the image, the captions and the Notes, a teleport of the image (paired by its
    // channel, no edge between the two), an LLM fed the Notes by a field mapping, a sub-workflow
    // fed the captioned video, and a fan-out clone of a node made from the video.
    n("intro", "upload-video", { url: "https://cdn.example/intro.mp4" }),
    n("outro", "combine-videos", { transition: "cut", ...rendered(OUTRO) }),
    n("upscale", "upscale-image", { upscaleFactor: 2, ...rendered(UPSCALED, "generatedImageUrl") }),
    n("preview", "preview", {
      previewItems: [
        { type: "image", value: PHOTO, itemKey: "creator:image", sourceNodeId: "creator", sourceHandle: "image", sourceNodeLabel: "creator", visible: true },
        { type: "video", value: CAPTIONED, itemKey: "captions:out", sourceNodeId: "captions", sourceNodeLabel: "captions", visible: true },
        { type: "text", value: NOTES, itemKey: "cards:report", sourceNodeId: "cards", sourceHandle: "report", sourceNodeLabel: "cards", visible: true },
      ],
      itemOrder: ["creator:image", "captions:out", "cards:report"],
      executionStatus: "completed",
    }),
    n("send", "teleport-send", { channel: "A", channelColor: "#fff", result: PHOTO }),
    n("receive", "teleport-receive", { channel: "A", channelColor: "#fff", result: PHOTO }),
    n("restyle", "modify-image", { prompt: "brighter", ...rendered(TELEPORTED, "generatedImageUrl") }),
    n("writer", "llm-chat", { userInput: "Write a caption from {Notes}", fieldMappings: { notes: { sourceNodeId: "cards" } }, generatedText: WRITTEN, executionStatus: "completed" }),
    n("nested", "sub-workflow", { workflowId: "wf-child", outputResults: { out: NESTED }, generatedResults: [{ url: NESTED, jobId: "sub-1", timestamp: "t" }], activeResultIndex: 0, executionStatus: "completed" }),
    n("upscale_iter_0", "upscale-image", { upscaleFactor: 2, __expandedClone: true, __expandedFrom: "upscale", generatedImageUrl: ROW, generatedResults: [{ url: ROW, jobId: "", timestamp: "t" }] }),
    // Outside the video: a plain video, and a Preview of the screenshot.
    n("gen", "generate-video", { prompt: "a cat", ...rendered(OUTSIDE) }),
    n("shotPreview", "preview", {
      previewItems: [{ type: "image", value: SCREENSHOT, itemKey: "shot1:image", sourceNodeId: "shot1", sourceNodeLabel: "shot1", visible: true }],
      itemOrder: ["shot1:image"],
    }),
  ]
  const edges: E[] = [
    e("site", "script", "site", "prompt"), e("shot1", "script", "screenshot", "image"), e("photo", "creator", "photo", "image"),
    e("script", "creator", "category", "category"), e("script", "clips", "plan", "plan"), e("creator", "clips", "creator", "creator"),
    e("clips", "clip", "clip", "clips"), e("clip", "join", "in", "video-out"), e("clip", "cards", "notes", "video-out"), e("clips", "cards", "plan", "plan-out"),
    e("clips", "cards", "transcript", "transcript"), e("join", "cards", "video", "video"), e("join", "overlay", "video", "video"),
    e("cards", "overlay", "layerPlan", "layerPlan"), e("cards", "captions", "captionPlan", "captionPlan"), e("overlay", "captions", "in", "video-out"),
    e("captions", "outro", "in", "video-out"), e("intro", "outro", "in2", "video"),
    e("creator", "upscale", "image", "image"),
    e("creator", "preview", "in", "image"), e("captions", "preview", "in", "video-out"), e("cards", "preview", "in", "report"),
    e("creator", "send", "in", "image"), e("receive", "restyle", "image", "out"),
    e("captions", "nested", "in", "video-out"),
    e("shot1", "shotPreview", "in", "image"),
  ]
  return { nodes, edges }
}

const dataById = (nodes: N[]) => new Map(nodes.map((x) => [x.id, x.data]))

describe("what anyone but the author receives of a UGC video", () => {
  it("every UGC node starts empty: its choices stay, Keep is off, and no run of the author's ships", () => {
    const { nodes, edges } = ranGraph()
    const byId = dataById(stripUgcPublishState(nodes, edges))
    expect(byId.get("script")).toEqual({ label: "script", targetDurationSec: 20, keepResult: false })
    expect(byId.get("creator")).toEqual({ label: "creator", source: "photo", gender: "man", keepResult: false })
    expect(byId.get("clips")).toEqual({ label: "clips", voiceId: "placeholder-voice" })
    expect(byId.get("clip")).toEqual({ label: "clip" })
    expect(byId.get("cards")).toEqual({ label: "cards" })
  })

  it("an Upload Image wired into the creator's photo input ships empty: no image, no copy of it, no file name", () => {
    const { nodes, edges } = ranGraph()
    expect(dataById(stripUgcPublishState(nodes, edges)).get("photo")).toEqual({ label: "photo", presentationInput: false })
  })

  it("the video's join, overlay and captions keep their settings and lose their renders; an address the author set stays — a logo layer of the overlay's own", () => {
    const { nodes, edges } = ranGraph()
    const byId = dataById(stripUgcPublishState(nodes, edges))
    expect(byId.get("join")).toEqual({ label: "join", transition: "cut", audioMode: "keep", smartCutEnabled: false })
    // The logo is the author's own file, not one a run made from the video: it is not tainted, and ships.
    expect(byId.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: "https://cdn.example/logo.png" }], layerCount: 1 })
    expect(byId.get("captions")).toEqual({ label: "captions", style: "body", fontSize: 48 })
  })

  it("every node made from the video loses what its runs left: through a wire, a teleport's channel, a field mapping, a Preview's items, a fan-out clone", () => {
    const { nodes, edges } = ranGraph()
    const byId = dataById(stripUgcPublishState(nodes, edges))
    expect(byId.get("outro")).toEqual({ label: "outro", transition: "cut" })
    expect(byId.get("upscale")).toEqual({ label: "upscale", upscaleFactor: 2 })
    expect(byId.get("preview")).toEqual({ label: "preview", previewItems: [], itemOrder: ["creator:image", "captions:out", "cards:report"] })
    expect(byId.get("send")).toEqual({ label: "send", channel: "A", channelColor: "#fff" })
    expect(byId.get("receive")).toEqual({ label: "receive", channel: "A", channelColor: "#fff" })
    expect(byId.get("restyle")).toEqual({ label: "restyle", prompt: "brighter" })
    expect(byId.get("writer")).toEqual({ label: "writer", userInput: "Write a caption from {Notes}", fieldMappings: { notes: { sourceNodeId: "cards" } } })
    expect(byId.get("nested")).toEqual({ label: "nested", workflowId: "wf-child" })
    expect(byId.get("upscale_iter_0")).toEqual({ label: "upscale_iter_0", upscaleFactor: 2, __expandedClone: true, __expandedFrom: "upscale" })
  })

  it("ships none of the author's photo, takes, joined video, cards, Notes or anything made from them", () => {
    const { nodes, edges } = ranGraph()
    const shipped = JSON.stringify(stripUgcPublishState(nodes, edges))
    for (const own of [PHOTO, PHOTO_THUMB, PHOTO_FILE, "asset-author", TAKE, JOINED, CARDED, CAPTIONED, NOTES, OUTRO, UPSCALED, TELEPORTED, WRITTEN, NESTED, ROW]) {
      expect(shipped, own).not.toContain(own)
    }
  })

  it("every node the video is not made from is returned as it is — the screenshots, a plain video, their Preview", () => {
    const { nodes, edges } = ranGraph()
    const out = stripUgcPublishState(nodes, edges)
    for (const id of ["site", "shot1", "intro", "gen", "shotPreview"]) {
      expect(out.find((x) => x.id === id), id).toBe(nodes.find((x) => x.id === id))
    }
    expect(JSON.stringify(out)).toContain(SCREENSHOT)
    expect(JSON.stringify(out)).toContain(OUTSIDE)
  })

  it("an Upload Image wired into the photo input through a teleport pair ships empty too", () => {
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()),
      n("tsend", "teleport-send", { channel: "P", channelColor: "#000" }),
      n("trecv", "teleport-receive", { channel: "P", channelColor: "#000" }),
      n("creator", "ugc-creator", { source: "photo", gender: "woman" }),
    ]
    const edges = [e("photo", "tsend", "in", "image"), e("trecv", "creator", "photo", "out")]
    const out = stripUgcPublishState(nodes, edges)
    expect(out.find((x) => x.id === "photo")!.data).toEqual({ label: "photo" })
    expect(JSON.stringify(out)).not.toContain(PHOTO)
  })

  it("a Group holding a UGC node is fed by it; another node in that Group is not", () => {
    const nodes: N[] = [
      n("group", "group", { generatedText: "made-from-group" }),
      { ...n("clipInGroup", "ugc-clip", rendered(TAKE)), parentId: "group" },
      { ...n("sibling", "generate-image", rendered("https://cdn.example/sibling.png", "generatedImageUrl")), parentId: "group" },
    ]
    const out = dataById(stripUgcPublishState(nodes, []))
    expect(out.get("group")).toEqual({ label: "group" })
    expect(out.get("sibling")!.generatedImageUrl).toBe("https://cdn.example/sibling.png")
  })

  it("a graph with no UGC node is returned as it is", () => {
    const nodes = [n("a", "upload-video"), n("j", "combine-videos", rendered(JOINED)), n("o", "video-overlay", rendered(CARDED)), n("c", "add-captions", rendered(CAPTIONED)), n("p", "upload-image", uploadedPhoto())]
    const edges = [e("a", "j", "in"), e("j", "o", "video"), e("o", "c", "in")]
    expect(stripUgcPublishState(nodes, edges)).toEqual(nodes)
  })

  it("changes nothing it is given", () => {
    const { nodes, edges } = ranGraph()
    const before = JSON.stringify(nodes)
    stripUgcPublishState(nodes, edges)
    expect(JSON.stringify(nodes)).toBe(before)
  })
})

describe("a node made only from the video or the photo's path clears an address in its settings only when it is tainted", () => {
  const LOGO = "https://cdn.example/brand-logo.png"
  const LOTTIE = "https://cdn.example/brand-intro.json"
  const TAKE_ASSET = "asset-0f3c2a9e-take-0001"
  const LIBRARY_COPY = "https://cdn.example/library/take-copy.mp4"
  /** The video and the nodes after it: an overlay whose layers are `layers`, a Lottie title, a restyle of the creator's image. */
  function shipped(layers: unknown[], more: N[] = [], moreEdges: E[] = []) {
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()),
      n("creator", "ugc-creator", { source: "photo", gender: "woman" }),
      n("clip", "ugc-clip", { generatedVideoUrl: TAKE, generatedResults: [{ url: TAKE, assetId: TAKE_ASSET, jobId: "j", timestamp: "t" }] }),
      n("overlay", "video-overlay", { layers, layerCount: layers.length }),
      n("title", "motion-graphics", { lottieUrl: LOTTIE }),
      n("restyle", "generate-image", { prompt: "brighter", referenceImageUrls: [LOGO] }),
      ...more,
    ]
    const edges = [e("photo", "creator", "photo", "image"), e("clip", "overlay", "video", "video-out"), e("overlay", "title", "in", "video-out"), e("creator", "restyle", "reference", "image"), ...moreEdges]
    return dataById(stripUgcPublishState(nodes, edges))
  }

  it("an address the author set — a logo layer, a Lottie file, a reference image — ships and keeps working", () => {
    const out = shipped([{ imageUrl: LOGO }])
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: LOGO }], layerCount: 1 })
    expect(out.get("title")).toEqual({ label: "title", lottieUrl: LOTTIE })
    expect(out.get("restyle")).toEqual({ label: "restyle", prompt: "brighter", referenceImageUrls: [LOGO] })
  })

  it("a layer that is a UGC render goes: by its address, with or without a query or a fragment, by its asset id, or by an address naming that id", () => {
    const out = shipped([{ imageUrl: LOGO }, { videoUrl: TAKE }, { videoUrl: `${TAKE}?token=abc#t=2` }, { assetId: TAKE_ASSET }, { posterUrl: `https://cdn.example/assets/${TAKE_ASSET}/poster.jpg` }])
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: LOGO }], layerCount: 5 })
  })

  it("a layer that is the author's photo, or anything on its path, goes — by its address or its asset id", () => {
    const out = shipped([{ imageUrl: PHOTO }, { imageUrl: `${PHOTO_THUMB}?v=3` }, { assetId: "asset-author" }, { imageUrl: LOGO }])
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: LOGO }], layerCount: 4 })
  })

  it("an asset is the same by its id or its address: a pair held anywhere taints the other form", () => {
    // The author's library copy of the take, outside the set: its address and the take's asset id, side by side.
    const out = shipped([{ videoUrl: LIBRARY_COPY }, { imageUrl: LOGO }], [n("library", "upload-video", { assetId: TAKE_ASSET, url: LIBRARY_COPY })])
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: LOGO }], layerCount: 2 })
    // The copy holds the take as its own value: it joins the set as a root, and ships empty.
    expect(out.get("library")).toEqual({ label: "library" })
  })

  it("a copy of an input a step keeps taints nothing: an outro the author set by its address still ships where a step copied it", () => {
    const OUTRO_FILE = "https://cdn.example/brand-outro.mp4"
    // The step is made from the video; it copied the author's outro as one of its inputs.
    const out = shipped([{ videoUrl: OUTRO_FILE }], [n("cut", "manual-edit", { mode: "trim", inputAssets: [{ url: OUTRO_FILE }], inputVideoUrl: OUTRO_FILE })], [e("clip", "cut", "in", "video-out")])
    expect(out.get("cut")).toEqual({ label: "cut", mode: "trim" })
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ videoUrl: OUTRO_FILE }], layerCount: 1 })
  })

  it("a library entity made from the video keeps no picture at all: whose its pictures are, the key cannot tell", () => {
    const out = shipped([], [n("who", "character", { characterName: "Me", sourceImageUrl: LOGO, defaultAssetUrl: LOGO })])
    // Not wired here: the entity outside the set keeps its pictures.
    expect(out.get("who")).toMatchObject({ sourceImageUrl: LOGO })
    const nodes = [n("creator", "ugc-creator", { source: "sampled", gender: "woman" }), n("who", "character", { characterName: "Me", sourceImageUrl: LOGO, defaultAssetUrl: LOGO })]
    expect(dataById(stripUgcPublishState(nodes, [e("creator", "who", "image", "image")])).get("who")).toEqual({ label: "who", characterName: "Me" })
  })

  it("a caller that read no taint clears every address, as before", () => {
    const nodes = [n("clip", "ugc-clip"), n("overlay", "video-overlay", { layers: [{ imageUrl: LOGO }], layerCount: 1 })]
    const out = stripUgcPublishState(nodes, [e("clip", "overlay", "video", "video-out")], { strip: new Set(["clip", "overlay"]), photo: new Set() })
    expect(dataById(out).get("overlay")).toEqual({ label: "overlay", layers: [], layerCount: 1 })
  })
})

describe("every node on a path that feeds a creator's photo input ships without the author's image", () => {
  const UPSCALED_FACE = "https://cdn.example/upscaled-author.png"
  const REFERENCE = "https://cdn.example/author-reference.png"
  const VARIANT = "https://cdn.example/author-smile.png"
  const LINK = "https://cdn.example/author-link.png"
  const creator = () => n("creator", "ugc-creator", { source: "photo", gender: "woman" })

  it("an upload through a step: the upload ships empty, and the step keeps its settings and loses what it made", () => {
    const nodes = [n("photo", "upload-image", uploadedPhoto()), n("step", "upscale-image", { upscaleFactor: 2, ...rendered(UPSCALED_FACE, "generatedImageUrl") }), creator()]
    const out = stripUgcPublishState(nodes, [e("photo", "step", "image", "image"), e("step", "creator", "photo", "image")])
    expect(dataById(out).get("photo")).toEqual({ label: "photo" })
    expect(dataById(out).get("step")).toEqual({ label: "step", upscaleFactor: 2 })
    for (const own of [PHOTO, PHOTO_THUMB, PHOTO_FILE, "asset-author", UPSCALED_FACE]) expect(JSON.stringify(out), own).not.toContain(own)
  })

  it("an upload through a teleport pair: the upload ships empty and the pair loses its value", () => {
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()),
      n("tsend", "teleport-send", { channel: "P", channelColor: "#000", result: PHOTO }),
      n("trecv", "teleport-receive", { channel: "P", channelColor: "#000", result: PHOTO }),
      creator(),
    ]
    const out = stripUgcPublishState(nodes, [e("photo", "tsend", "in", "image"), e("trecv", "creator", "photo", "out")])
    expect(dataById(out).get("tsend")).toEqual({ label: "tsend", channel: "P", channelColor: "#000" })
    expect(dataById(out).get("trecv")).toEqual({ label: "trecv", channel: "P", channelColor: "#000" })
    expect(JSON.stringify(out)).not.toContain(PHOTO)
  })

  it("whatever a node on the path holds of an image goes — an entity's picture and its variants, a reference image, a library asset — and its prompt and settings stay", () => {
    const nodes = [
      n("face", "character", { description: "keep this description", style: "photo", sourceImageUrl: REFERENCE, expressions: [{ name: "smile", url: VARIANT }], assetId: "asset-face" }),
      n("gen", "generate-image", { prompt: "a portrait", aspectRatio: "1:1", referenceImageUrls: [REFERENCE], ...rendered(UPSCALED_FACE, "generatedImageUrl") }),
      creator(),
    ]
    const out = stripUgcPublishState(nodes, [e("face", "gen", "reference", "image"), e("gen", "creator", "photo", "image")])
    // Its variants list keeps its place, every variant holding a file gone.
    expect(dataById(out).get("face")).toEqual({ label: "face", description: "keep this description", style: "photo", expressions: [] })
    expect(dataById(out).get("gen")).toEqual({ label: "gen", prompt: "a portrait", aspectRatio: "1:1" })
    for (const own of [REFERENCE, VARIANT, UPSCALED_FACE, "asset-face"]) expect(JSON.stringify(out), own).not.toContain(own)
  })

  it("nothing ends the walk: an upload the runner fills ships without the author's image, and so does what feeds its link input", () => {
    const nodes = [
      n("linker", "llm-chat", { userInput: "the photo's link", generatedText: LINK, executionStatus: "completed" }),
      n("photo", "upload-image", uploadedPhoto()),
      n("step", "upscale-image", { upscaleFactor: 2, ...rendered(UPSCALED_FACE, "generatedImageUrl") }),
      creator(),
    ]
    const edges = [e("linker", "photo", "in", "text"), e("photo", "step", "image", "image"), e("step", "creator", "photo", "image")]
    const out = dataById(stripUgcPublishState(nodes, edges))
    expect(out.get("photo")).toEqual({ label: "photo" })
    expect(out.get("step")).toEqual({ label: "step", upscaleFactor: 2 })
    expect(out.get("linker")).toEqual({ label: "linker", userInput: "the photo's link" })
    expect(JSON.stringify([...out.values()])).not.toContain(LINK)
  })

  it("what feeds the creator's other inputs keeps what it holds", () => {
    const nodes = [n("photo", "upload-image", uploadedPhoto()), n("shot", "upload-image", { url: SCREENSHOT, r2Url: SCREENSHOT, assetId: "asset-shot" }), n("look", "styling", { makeup: "natural" }), creator()]
    const out = stripUgcPublishState(nodes, [e("photo", "creator", "photo", "image"), e("shot", "creator", "category", "image"), e("look", "creator", "pickers", "out")])
    expect(out.find((x) => x.id === "shot")).toBe(nodes[1])
    expect(out.find((x) => x.id === "look")).toBe(nodes[2])
  })

  it("a step's field mappings stay — a mapping names a node, never a file — while the addresses beside them go", () => {
    const mappings = { imageUrl: { sourceNodeId: "photo" }, prompt: { sourceNodeId: "brief" } }
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()),
      n("brief", "text-prompt", { text: "brighter" }),
      n("scrape", "web-scrape", { actor: "page", url: LINK, fieldMappings: { url: { sourceNodeId: "brief" } } }),
      n("step", "modify-image", { prompt: "{Brief}", fieldMappings: mappings, imageUrl: PHOTO, ...rendered(UPSCALED_FACE, "generatedImageUrl") }),
      creator(),
    ]
    const edges = [e("photo", "step", "image", "image"), e("scrape", "step", "reference", "image"), e("step", "creator", "photo", "image")]
    const out = dataById(stripUgcPublishState(nodes, edges))
    expect(out.get("step")).toEqual({ label: "step", prompt: "{Brief}", fieldMappings: mappings })
    expect(out.get("scrape")).toEqual({ label: "scrape", actor: "page", fieldMappings: { url: { sourceNodeId: "brief" } } })
  })

  it("a file's address under a key no rule names, at any depth, goes too; the prompt and other settings stay", () => {
    const nodes = [
      n("gen", "generate-image", { prompt: "a portrait", aspectRatio: "1:1", referenceImages: [REFERENCE], sourceImage: PHOTO, nested: { deep: [{ picture: VARIANT }] }, seed: 7 }),
      creator(),
    ]
    const out = dataById(stripUgcPublishState(nodes, [e("gen", "creator", "photo", "image")]))
    expect(out.get("gen")).toEqual({ label: "gen", prompt: "a portrait", aspectRatio: "1:1", seed: 7 })
  })
})

describe("the keys that hold a node's own value (ugcPhotoValueKey)", () => {
  it("a file's address, an asset, an upload's file, a Text node's text, a List's rows — never a step's prompt or a setting", () => {
    for (const [key, type] of [["url", "upload-image"], ["r2Url", "upload-image"], ["filename", "upload-image"], ["assetId", "character"], ["text", "text-prompt"], ["text", "style-guide"], ["items", "list"], ["rows", "list"], ["sourceImageUrl", "character"], ["youtubeUrl", "youtube-video"]] as const) {
      expect(ugcPhotoValueKey(key, type), `${type}.${key}`).toBe(true)
    }
    for (const [key, type] of [["prompt", "generate-image"], ["prompt", "llm-chat"], ["prompt", "modify-image"], ["text", "generate-image"], ["scale", "upscale-image"], ["filename", "generate-image"], ["count", "scene-count"], ["source", "ugc-creator"]] as const) {
      expect(ugcPhotoValueKey(key, type), `${type}.${key}`).toBe(false)
    }
  })
})

describe("a sub-workflow whose graph holds a UGC video is read as one of the video's nodes", () => {
  const ROW_OUT = "https://cdn.example/nested-upscaled.mp4"
  function graph() {
    const nodes = [
      n("nested", "sub-workflow", { workflowId: "wf-child", outputResults: { out: NESTED }, generatedResults: [{ url: NESTED, jobId: "sub-1", timestamp: "t" }], activeResultIndex: 0, executionStatus: "completed" }),
      n("after", "video-upscale", { upscaleFactor: 2, ...rendered(ROW_OUT) }),
      n("gen", "generate-video", { prompt: "a cat", ...rendered(OUTSIDE) }),
    ]
    return { nodes, edges: [e("nested", "after", "in", "out")] }
  }

  it("it loses its stored outputs, and every node downstream of it what its runs left — though the graph holds no UGC node of its own", () => {
    const { nodes, edges } = graph()
    // The caller's strip set names the sub-workflow (its graph holds a UGC video) and what it feeds.
    const out = stripUgcPublishState(nodes, edges, { strip: new Set(["nested", "after"]) })
    expect(dataById(out).get("nested")).toEqual({ label: "nested", workflowId: "wf-child" })
    expect(dataById(out).get("after")).toEqual({ label: "after", upscaleFactor: 2 })
    expect(out.find((x) => x.id === "gen")).toBe(nodes[2])
    for (const own of [NESTED, ROW_OUT]) expect(JSON.stringify(out), own).not.toContain(own)
  })

  it("one not named so is a node like any other", () => {
    const { nodes, edges } = graph()
    expect(stripUgcPublishState(nodes, edges)).toEqual(nodes)
  })
})

describe("a value that flows into an upload's link input on a photo path ships empty", () => {
  const LINK = "https://cdn.example/author-face-link.png"
  const creator = () => n("creator", "ugc-creator", { source: "photo", gender: "woman" })

  it("a Text node holding the photo's link, wired into the upload's link input: its text is gone, and so is a Text node prompting a step on the path", () => {
    const nodes = [
      n("link", "text-prompt", { text: LINK }),
      n("photo", "upload-image", uploadedPhoto()),
      n("brief", "text-prompt", { text: "brighter, warmer" }),
      n("step", "modify-image", { prompt: "keep the face", ...rendered(PHOTO_THUMB, "generatedImageUrl") }),
      creator(),
    ]
    const edges = [e("link", "photo", "in", "prompt"), e("photo", "step", "image", "image"), e("brief", "step", "prompt", "prompt"), e("step", "creator", "photo", "image")]
    const out = dataById(stripUgcPublishState(nodes, edges))
    expect(out.get("link")).toEqual({ label: "link" })
    expect(out.get("photo")).toEqual({ label: "photo" })
    expect(out.get("brief")).toEqual({ label: "brief" })
    // A step's own prompt field is a setting: it stays.
    expect(out.get("step")).toEqual({ label: "step", prompt: "keep the face" })
    expect(JSON.stringify([...out.values()])).not.toContain(LINK)
  })

  it("through an LLM and a teleport pair: everything whose value reaches the link input loses it", () => {
    const nodes = [
      n("source", "text-prompt", { text: LINK }),
      n("writer", "llm-chat", { systemPrompt: "Return the link as it is", generatedText: LINK, executionStatus: "completed" }),
      n("tsend", "teleport-send", { channel: "L", result: LINK }),
      n("trecv", "teleport-receive", { channel: "L", result: LINK }),
      n("photo", "upload-image", uploadedPhoto()),
      creator(),
    ]
    const edges = [e("source", "writer", "prompt", "prompt"), e("writer", "tsend", "in", "text"), e("trecv", "photo", "in", "out"), e("photo", "creator", "photo", "image")]
    const out = dataById(stripUgcPublishState(nodes, edges))
    expect(out.get("source")).toEqual({ label: "source" })
    expect(out.get("writer")).toEqual({ label: "writer", systemPrompt: "Return the link as it is" })
    expect(JSON.stringify([...out.values()])).not.toContain(LINK)
  })

  it("a List whose rows are the photo's links loses its rows", () => {
    const nodes = [n("links", "list", { items: [LINK], rows: [[LINK]], columns: [{ name: "Link" }] }), n("photo", "upload-image", uploadedPhoto()), creator()]
    const out = dataById(stripUgcPublishState(nodes, [e("links", "photo", "in", "items"), e("photo", "creator", "photo", "image")]))
    expect(out.get("links")).toEqual({ label: "links", columns: [{ name: "Link" }] })
  })

  it("a value that feeds no creator's photo keeps it", () => {
    const nodes = [n("site", "text-prompt", { text: LINK }), n("script", "ugc-script"), n("photo", "upload-image", uploadedPhoto()), creator()]
    const out = stripUgcPublishState(nodes, [e("site", "script", "site", "prompt"), e("photo", "creator", "photo", "image")])
    expect(out.find((x) => x.id === "site")).toBe(nodes[0])
  })
})

describe("a graph's part of the photo influence set, read by the caller over its sub-workflows (photoInfluence)", () => {
  const UPSCALED_FACE = "https://cdn.example/upscaled-author.png"
  const BACKGROUND = "https://cdn.example/background.png"
  /** A sub-workflow's graph whose output feeds a creator's photo above it: no UGC node of its own. */
  function child() {
    const nodes = [
      n("up", "upload-image", uploadedPhoto()),
      n("step", "upscale-image", { upscaleFactor: 2, ...rendered(UPSCALED_FACE, "generatedImageUrl") }),
      n("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] }),
      n("bg", "upload-image", { url: BACKGROUND, r2Url: BACKGROUND, assetId: "asset-bg" }),
      n("card", "generate-image", { prompt: "a card", ...rendered(OUTSIDE, "generatedImageUrl") }),
    ]
    return { nodes, edges: [e("up", "step", "image", "image"), e("step", "out", "p1", "image"), e("bg", "card", "reference", "image")] }
  }

  it("every node it names loses its stored value, though the graph holds no UGC node; the rest keep theirs", () => {
    const { nodes, edges } = child()
    const out = stripUgcPublishState(nodes, edges, { strip: new Set(["out", "step", "up"]), photo: new Set(["out", "step", "up"]) })
    expect(dataById(out).get("up")).toEqual({ label: "up" })
    expect(dataById(out).get("step")).toEqual({ label: "step", upscaleFactor: 2 })
    expect(out.find((x) => x.id === "bg")).toBe(nodes[3])
    expect(out.find((x) => x.id === "card")).toBe(nodes[4])
    for (const own of [PHOTO, UPSCALED_FACE, "asset-author"]) expect(JSON.stringify(out), own).not.toContain(own)
  })

  it("not given, the set is read on the graph alone: here it holds no creator, so it is returned as it is", () => {
    const { nodes, edges } = child()
    expect(stripUgcPublishState(nodes, edges)).toEqual(nodes)
  })
})

describe("the author's photo or a UGC render used again anywhere in the graph", () => {
  const creator = () => n("creator", "ugc-creator", { source: "photo", gender: "woman" })
  const BRAND = "https://cdn.example/brand-logo.png"

  it("a copy of the photo's upload, wired to nothing that reaches a creator, holds the photo of its own: it ships empty, and so does what it feeds", () => {
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()), creator(),
      n("copy", "upload-image", { ...uploadedPhoto(), label: "copy" }),
      n("side", "upscale-image", { upscaleFactor: 2, ...rendered(UPSCALED, "generatedImageUrl") }),
      n("lone", "generate-image", { prompt: "a cat", ...rendered(OUTSIDE, "generatedImageUrl") }),
    ]
    const out = dataById(stripUgcPublishState(nodes, [e("photo", "creator", "photo", "image"), e("copy", "side", "image", "image")]))
    expect(out.get("copy")).toEqual({ label: "copy" })
    expect(out.get("side")).toEqual({ label: "side", upscaleFactor: 2 })
    expect(out.get("lone")).toMatchObject({ generatedImageUrl: OUTSIDE })
  })

  it("a take dropped into an Upload Video that nothing wires after the video ships empty", () => {
    const nodes = [n("clip", "ugc-clip", { ...rendered(TAKE) }), n("dropped", "upload-video", { url: TAKE, r2Url: TAKE, filename: "take.mp4" })]
    expect(dataById(stripUgcPublishState(nodes, [])).get("dropped")).toEqual({ label: "dropped" })
  })

  it("a node outside the set keeps its own configuration, but never a tainted address in it; an untouched node is returned as it is", () => {
    const nodes = [
      n("photo", "upload-image", uploadedPhoto()), creator(),
      n("other", "generate-image", { prompt: `a poster like ${PHOTO}`, referenceImageUrls: [PHOTO, BRAND] }),
      n("plain", "generate-image", { prompt: "a cat", referenceImageUrls: [BRAND] }),
    ]
    const out = stripUgcPublishState(nodes, [e("photo", "creator", "photo", "image")])
    expect(dataById(out).get("other")).toEqual({ label: "other", prompt: "a poster like", referenceImageUrls: [BRAND] })
    expect(out.find((x) => x.id === "plain")).toBe(nodes[3])
  })
})

describe("an address inside a sentence", () => {
  const creator = () => n("creator", "ugc-creator", { source: "photo", gender: "woman" })

  it("on a creator's photo path, every address is cut out of a prompt, which keeps the rest of its words", () => {
    const nodes = [
      n("writer", "llm-chat", { userInput: `Return exactly this link: ${PHOTO}`, systemPrompt: "Answer with a link only" }),
      n("photo", "upload-image", uploadedPhoto()),
      n("gen", "generate-image", { prompt: "a portrait in the style of https://cdn.example/style.png, soft light" }),
      creator(),
    ]
    const out = dataById(stripUgcPublishState(nodes, [e("writer", "photo", "in", "text"), e("photo", "gen", "image", "image"), e("gen", "creator", "photo", "image")]))
    expect(out.get("writer")).toEqual({ label: "writer", userInput: "Return exactly this link:", systemPrompt: "Answer with a link only" })
    expect(out.get("gen")).toEqual({ label: "gen", prompt: "a portrait in the style of , soft light" })
  })

  it("made only from the video, only a tainted address is cut: the take quoted in a prompt goes, another link stays", () => {
    const nodes = [n("clip", "ugc-clip", { ...rendered(TAKE) }), n("restyle", "generate-video", { prompt: `match ${TAKE} and https://cdn.example/brand.mp4` })]
    const out = dataById(stripUgcPublishState(nodes, [e("clip", "restyle", "video", "video-out")]))
    expect(out.get("restyle")).toMatchObject({ prompt: "match and https://cdn.example/brand.mp4" })
  })
})

describe("the same address spelled another way is the same address", () => {
  const SPELLINGS = [
    TAKE.replace("https:", "http:"),
    TAKE.replace("cdn.example", "CDN.Example"),
    TAKE.replace("https:", "HTTPS:"),
    TAKE.replace("take.mp4", "t%61ke.mp4"),
    TAKE.replace("cdn.example", "cdn.example:443"),
    TAKE.replace("cdn.example/", "cdn.example//"),
    `${TAKE}?token=abc#t=2`,
    `/v1/image-proxy?url=${encodeURIComponent(TAKE)}`,
    `https://app.example/v1/download?name=x&url=${encodeURIComponent(TAKE)}`,
  ]
  it.each(SPELLINGS)("a layer at %s goes", (spelling) => {
    const nodes = [n("clip", "ugc-clip", { ...rendered(TAKE) }), n("overlay", "video-overlay", { layers: [{ videoUrl: spelling }, { imageUrl: "https://cdn.example/logo.png" }], layerCount: 2 })]
    const out = dataById(stripUgcPublishState(nodes, [e("clip", "overlay", "video", "video-out")]))
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [{ imageUrl: "https://cdn.example/logo.png" }], layerCount: 2 })
  })

  it("an address on the deployment's own storage, on any of its hosts, is the object it names", () => {
    const storage = (address: string) => (/^https?:\/\/(?:media\.example|fallback\.example)\//i.test(address) ? address.replace(/^https?:\/\/[^/]+\//i, "") : null)
    const nodes = [
      n("clip", "ugc-clip", { generatedVideoUrl: "https://media.example/u/take-1.mp4" }),
      n("overlay", "video-overlay", { layers: [{ videoUrl: "https://fallback.example/u/take-1.mp4" }], layerCount: 1 }),
    ]
    const edges = [e("clip", "overlay", "video", "video-out")]
    const sets = ugcStripSet(ugcComposedOf(nodes, edges), new Map(), { storage })
    const root = ugcComposedKey([])
    const out = dataById(stripUgcPublishState(nodes, edges, { strip: sets.strip.get(root), photo: sets.photo.get(root), sinks: sets.sinks?.get(root), taint: sets.taint }))
    expect(out.get("overlay")).toEqual({ label: "overlay", layers: [], layerCount: 1 })
  })
})

describe("a copy of an input one node type keeps under its own key", () => {
  it("Paint Mask's source and a generator's refine base, made from the creator's image, go: they are earlier renders, not settings", () => {
    const OLD_FACE = "https://cdn.example/earlier-creator-image.png"
    const nodes = [
      n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
      n("mask", "paint-mask", { sourceImageUrl: OLD_FACE, maskUrl: "https://cdn.example/mask.png" }),
      n("refine", "generate-image", { prompt: "sharper", baseImageUrl: OLD_FACE }),
    ]
    const out = dataById(stripUgcPublishState(nodes, [e("creator", "mask", "image", "image"), e("creator", "refine", "reference", "image")]))
    expect(out.get("mask")).toEqual({ label: "mask", maskUrl: "https://cdn.example/mask.png" })
    expect(out.get("refine")).toEqual({ label: "refine", prompt: "sharper" })
  })
})

describe("a setting the executor reads ships, though the node's data type does not declare it", () => {
  it("a Kling 3 video made from the creator's image keeps its mode, sound, guidance and watermark settings", () => {
    const settings = { provider: "kling-3.0", duration: 5, mode: "pro", sound: false, kling3Mode: "4K", kling3Sound: false, cfgScale: 0.5, removeWatermark: true }
    const nodes = [n("creator", "ugc-creator", { source: "sampled", gender: "woman" }), n("i2v", "image-to-video", { ...settings, ...rendered(TAKE) }), n("gv", "generate-video", { ...settings, fps: 24 })]
    const out = dataById(stripUgcPublishState(nodes, [e("creator", "i2v", "image", "image"), e("creator", "gv", "image", "image")]))
    expect(out.get("i2v")).toMatchObject(settings)
    expect(out.get("gv")).toMatchObject({ ...settings, fps: 24 })
  })

  it("older spellings a run still reads: captions' style and place, a loop count, a mix's volumes, a voice", () => {
    const nodes = [
      n("clip", "ugc-clip", { ...rendered(TAKE) }),
      n("cap", "add-captions", { captionStyle: "bold", captionPosition: "bottom", transcript: "the author's words", ...rendered(CAPTIONED) }),
      n("loop", "loop-video", { loops: 3 }),
      n("mix", "mix-audio", { volumes: [1, 0.4] }),
    ]
    const out = dataById(stripUgcPublishState(nodes, [e("clip", "cap", "in", "video-out"), e("cap", "loop", "in", "video-out"), e("loop", "mix", "in", "video")]))
    expect(out.get("cap")).toEqual({ label: "cap", captionStyle: "bold", captionPosition: "bottom" })
    expect(out.get("loop")).toEqual({ label: "loop", loops: 3 })
    expect(out.get("mix")).toEqual({ label: "mix", volumes: [1, 0.4] })
  })
})

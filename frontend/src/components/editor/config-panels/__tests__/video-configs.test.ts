import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { render } from "@testing-library/react"
import {
  buildVideoRefAutocomplete,
  toRefImageItems,
  buildVideoRefVideoAutocomplete,
  buildVideoRefAudioAutocomplete,
} from "../video-configs"
import {
  buildImageConnectedReferences,
  connectedReferencesToRefImages,
  type ConnectedRefsData,
} from "../connected-references"
import { FramesAndReferencesTip } from "../frames-references-tip"
import type { SourceNodeInfo } from "../types"

function imgSource(
  id: string,
  targetHandle: string,
  url: string,
  type = "upload-image",
): SourceNodeInfo {
  return { id, type, label: id, value: "", targetHandle, nodeData: { url } }
}

/** A source wired into a reference-VIDEO / reference-AUDIO handle. The handle id
 *  is what `referenceModalityForHandle` keys off of (legacy `reference-videos` /
 *  `reference-audio` AND the canonical `videoReferences` / `audioReferences`). */
function mediaSource(
  id: string,
  targetHandle: string,
  url: string,
  type = "generate-video",
): SourceNodeInfo {
  return { id, type, label: id, value: "", targetHandle, nodeData: { url } }
}

describe("video-configs {image:N} numbering — reference-handle images only", () => {
  // Backend `reference_image_urls` lists reference-handle images first and
  // appends the start/end frame at the TAIL. The editor's `{image:N}` token
  // must therefore number the `references` handle images ONLY — the start
  // frame must NOT consume slot 1 (that desyncs editor token N from backend
  // reference slot N).
  it("numbers the two reference images 1 and 2 and excludes the start frame", () => {
    const sources: SourceNodeInfo[] = [
      // Start frame deliberately FIRST so the buggy `i + 1` numbering would
      // hand it index 1 and bump the references to 2/3.
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("ref2", "references", "https://r2/ref2.png", "generate-image"),
    ]

    const items = toRefImageItems(buildVideoRefAutocomplete(sources))

    // Start frame is not a reference → no {image:N} item at all.
    expect(items.find((i) => i.url === "https://r2/start.png")).toBeUndefined()

    // The two references are numbered 1 and 2, matching backend slot order.
    expect(items.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(items.find((i) => i.url === "https://r2/ref2.png")?.index).toBe(2)
    expect(items).toHaveLength(2)
  })

  it("excludes an end frame and keeps reference numbering 1-based", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("endFrame", "endFrame", "https://r2/end.png"),
    ]
    const items = toRefImageItems(buildVideoRefAutocomplete(sources))
    expect(items.find((i) => i.url === "https://r2/end.png")).toBeUndefined()
    expect(items.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(items).toHaveLength(1)
  })

  it("leaves reference numbering intact when no frame is wired", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("ref2", "references", "https://r2/ref2.png"),
    ]
    const items = toRefImageItems(buildVideoRefAutocomplete(sources))
    expect(items.map((i) => i.index)).toEqual([1, 2])
  })
})

describe("video-configs {video:N} / {audio:N} reference numbering", () => {
  // Independent positional numbering per modality — a wired reference VIDEO is
  // `{video:N}` (N counting video handles only), a wired reference AUDIO is
  // `{audio:N}` (N counting audio handles only). Both start at 1 and ignore
  // each other AND the image-reference handles, so the editor token N maps 1:1
  // to the backend `referenceVideoUrls` / `referenceAudioUrls` slot N (counted
  // the same way via the shared `referenceModalityForHandle`).
  it("numbers two wired reference VIDEOS 1 and 2 (source 'video'), both legacy + canonical handle ids", () => {
    const sources: SourceNodeInfo[] = [
      mediaSource("v1", "videoReferences", "https://r2/v1.mp4"),
      mediaSource("v2", "reference-videos", "https://r2/v2.mp4"),
    ]
    const items = buildVideoRefVideoAutocomplete(sources)
    expect(items.map((i) => i.index)).toEqual([1, 2])
    expect(items.every((i) => i.source === "video")).toBe(true)
    expect(items.map((i) => i.url)).toEqual(["https://r2/v1.mp4", "https://r2/v2.mp4"])
  })

  it("numbers reference AUDIO independently of video and ignores image/frame handles", () => {
    const sources: SourceNodeInfo[] = [
      mediaSource("v1", "videoReferences", "https://r2/v1.mp4"),
      mediaSource("a1", "audioReferences", "https://r2/a1.mp3"),
      mediaSource("a2", "reference-audio", "https://r2/a2.mp3"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("frame", "startFrame", "https://r2/start.png"),
    ]
    const audio = buildVideoRefAudioAutocomplete(sources)
    expect(audio.map((i) => i.index)).toEqual([1, 2])
    expect(audio.every((i) => i.source === "audio")).toBe(true)
    // Video numbering is independent — it sees only the single video handle.
    expect(buildVideoRefVideoAutocomplete(sources).map((i) => i.index)).toEqual([1])
  })

  it("returns nothing when only frames / image refs are wired (no video/audio handles)", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "references", "https://r2/ref1.png"),
    ]
    expect(buildVideoRefVideoAutocomplete(sources)).toHaveLength(0)
    expect(buildVideoRefAudioAutocomplete(sources)).toHaveLength(0)
  })
})

describe("cross-surface {image:N} numbering parity — config panel vs inline/modal", () => {
  // INVARIANT-2 guard (the C1 regression): editor `{image:N}` numbering has ONE
  // authority across surfaces. The config panel builds it via
  // `toRefImageItems(buildVideoRefAutocomplete(...))`; the inline canvas editor +
  // quick-edit modal build it via
  // `connectedReferencesToRefImages(buildImageConnectedReferences(...))`. Both
  // MUST exclude start/end frames and number the SAME reference image the SAME
  // way — otherwise the inline editor offers a token whose N is out-of-range at
  // the backend (`countRefModalityEdges` excludes frames) → the reference binding
  // is silently dropped on a paid run (the canonical i2v-with-frame scenario).

  /** The inline/modal surface's `{image:N}` items for the given wired sources. */
  function inlineImageItems(sources: SourceNodeInfo[]) {
    return connectedReferencesToRefImages(
      buildImageConnectedReferences({
        data: {} as ConnectedRefsData,
        sources,
        nodes: [],
        attachedChars: [],
      }),
    )
  }
  /** The config-panel surface's `{image:N}` items for the same sources. */
  function configImageItems(sources: SourceNodeInfo[]) {
    return toRefImageItems(buildVideoRefAutocomplete(sources))
  }

  it("a start frame + one reference image: BOTH number the reference 1, NEITHER offers a {image:N} for the frame", () => {
    // Start frame deliberately FIRST (the natural add order) so the pre-fix
    // frame-blind `i + 1` numbering would have handed the frame index 1 and the
    // reference index 2 on the inline/modal surface.
    const sources: SourceNodeInfo[] = [
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref1", "imageReferences", "https://r2/ref1.png"),
    ]

    const cfg = configImageItems(sources)
    const inl = inlineImageItems(sources)

    // Neither surface offers a {image:N} item for the frame.
    expect(cfg.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
    expect(inl.find((i) => i.url === "https://r2/start.png")).toBeUndefined()

    // Both surfaces number the reference 1 — identical numbering.
    expect(cfg.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(inl.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)

    // One numbered reference each (the frame is gone, not just renumbered).
    expect(cfg).toHaveLength(1)
    expect(inl).toHaveLength(1)
  })

  it("two reference images around a frame: BOTH number 1,2 identically and exclude the frame", () => {
    const sources: SourceNodeInfo[] = [
      imgSource("ref1", "references", "https://r2/ref1.png"),
      imgSource("frame", "startFrame", "https://r2/start.png"),
      imgSource("ref2", "imageReferences", "https://r2/ref2.png"),
    ]

    const cfg = configImageItems(sources)
    const inl = inlineImageItems(sources)

    // Identical {url → index} numbering across both surfaces, frame excluded.
    const numbering = (items: ReturnType<typeof configImageItems>) =>
      items.map((i) => `${i.url}#${i.index}`)
    expect(numbering(inl)).toEqual(numbering(cfg))
    expect(cfg.find((i) => i.url === "https://r2/ref1.png")?.index).toBe(1)
    expect(cfg.find((i) => i.url === "https://r2/ref2.png")?.index).toBe(2)
    expect(cfg.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
    expect(inl.find((i) => i.url === "https://r2/start.png")).toBeUndefined()
  })
})

describe("FramesAndReferencesTip", () => {
  it("renders the approximation note only when BOTH a frame and a reference are present", () => {
    const { container, rerender } = render(
      createElement(FramesAndReferencesTip, { hasFrame: true, hasReference: true }),
    )
    expect(container.textContent).toMatch(/approximated via the prompt/i)

    rerender(createElement(FramesAndReferencesTip, { hasFrame: true, hasReference: false }))
    expect(container).toBeEmptyDOMElement()

    rerender(createElement(FramesAndReferencesTip, { hasFrame: false, hasReference: true }))
    expect(container).toBeEmptyDOMElement()

    rerender(createElement(FramesAndReferencesTip, { hasFrame: false, hasReference: false }))
    expect(container).toBeEmptyDOMElement()
  })
})

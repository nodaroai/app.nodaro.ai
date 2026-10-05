/**
 * The config-panel results gallery shows each node's results as the medium the
 * node produces. Apply EDL produces video OR audio, set by its `output` field,
 * so its gallery follows that field (A1-0). It used to fall through to "image":
 * broken image tiles, Save to Library as an image, and a pick written to
 * `generatedImageUrl` (the engine split covered by apply-edl-picked-take.test.tsx).
 *
 * Each result is shown as the medium of its own file, for every node type; the
 * node's medium is the fallback for a URL that names none. A node whose medium
 * is a setting keeps its results across a change of that setting, and its pick
 * write follows the setting, the way the node's own canvas picker writes it —
 * and on Apply EDL a take of the other medium than its Output cannot be picked
 * at all (decided 2026-10-04). Every other node's pick writes the field of its
 * result's own medium; the census of every gallery type is
 * results-gallery-medium-census.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }))

vi.mock("@/components/presentation/output-cards/shared", () => ({ downloadFile }))
vi.mock("@/hooks/use-workflow-store", () => {
  const state = { setWorkflowThumbnail: () => {} }
  return { useWorkflowStore: (select: (s: typeof state) => unknown) => select(state) }
})
vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: (p: { type: string }) => <div data-testid="save-to-library" data-type={p.type} />,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (p: { src?: string; alt?: string }) => <img data-testid="image-tile" src={p.src} alt={p.alt} />,
}))
vi.mock("../job-config-display", () => ({ JobConfigDisplay: () => null }))

import { ResultsGallery } from "../results-gallery"
import {
  resultsGalleryMediaType,
  resultsGalleryPickPatch,
  resultsGalleryPickRefusal,
  resultsGalleryTakeMedium,
} from "../results-gallery-media"

afterEach(cleanup)

const results = (ext: string) => [
  { url: `https://media.test/take-2.${ext}`, timestamp: "2026-10-04T12:00:00.000Z", jobId: "job-2" },
  { url: `https://media.test/take-1.${ext}`, timestamp: "2026-10-04T11:00:00.000Z", jobId: "job-1" },
]

function renderGallery(nodeType: string, nodeData: Record<string, unknown>) {
  const onUpdate = vi.fn()
  render(<ResultsGallery nodeId="node-1" nodeType={nodeType} nodeData={nodeData} onUpdate={onUpdate} />)
  return onUpdate
}

function pickSecond(nodeType: string, nodeData: Record<string, unknown>): unknown {
  const onUpdate = renderGallery(nodeType, nodeData)
  fireEvent.click(screen.getByRole("button", { name: "Result 2" }))
  expect(onUpdate).toHaveBeenCalledTimes(1)
  return onUpdate.mock.calls[0][0]
}

describe("resultsGalleryMediaType — Apply EDL follows its `output` field", () => {
  it("is video for a video render, and for a node saved before `output` existed (video is the default)", () => {
    expect(resultsGalleryMediaType("apply-edl", { output: "video" })).toBe("video")
    expect(resultsGalleryMediaType("apply-edl", {})).toBe("video")
  })

  it("is audio for an audio render", () => {
    expect(resultsGalleryMediaType("apply-edl", { output: "audio" })).toBe("audio")
  })
})

describe("the Apply EDL gallery shows the cut as the medium it is", () => {
  it("video output: video tiles (no image tiles), Save to Library as video, Set as thumbnail offered", () => {
    renderGallery("apply-edl", { output: "video", generatedResults: results("mp4"), activeResultIndex: 0 })
    expect(screen.queryByTestId("image-tile")).toBeNull()
    expect(screen.getByRole("button", { name: "Result 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Result 2" })).toBeInTheDocument()
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "video")
    expect(screen.getByRole("button", { name: /Set as Thumbnail/i })).toBeInTheDocument()
  })

  it("audio output: audio tiles, Save to Library as audio, no thumbnail action", () => {
    renderGallery("apply-edl", { output: "audio", generatedResults: results("m4a"), activeResultIndex: 0 })
    expect(screen.queryByTestId("image-tile")).toBeNull()
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "audio")
    expect(screen.queryByRole("button", { name: /Set as Thumbnail/i })).toBeNull()
  })

  it("video output: picking writes the video field and clears the audio one", () => {
    expect(pickSecond("apply-edl", { output: "video", generatedResults: results("mp4"), activeResultIndex: 0 })).toStrictEqual({
      activeResultIndex: 1,
      generatedVideoUrl: "https://media.test/take-1.mp4",
      generatedAudioUrl: undefined,
      generatedJson: undefined,
    })
  })

  it("audio output: picking writes the audio field and clears the video one", () => {
    expect(pickSecond("apply-edl", { output: "audio", generatedResults: results("m4a"), activeResultIndex: 0 })).toStrictEqual({
      activeResultIndex: 1,
      generatedAudioUrl: "https://media.test/take-1.m4a",
      generatedVideoUrl: undefined,
      generatedJson: undefined,
    })
  })
})

describe("every other node type keeps the pick write it had", () => {
  it("an image node writes generatedImageUrl", () => {
    expect(pickSecond("generate-image", { generatedResults: results("png"), activeResultIndex: 0 })).toEqual({
      activeResultIndex: 1,
      generatedImageUrl: "https://media.test/take-1.png",
    })
  })

  it("a video node writes generatedVideoUrl and clears nothing", () => {
    expect(pickSecond("generate-video", { generatedResults: results("mp4"), activeResultIndex: 0 })).toEqual({
      activeResultIndex: 1,
      generatedVideoUrl: "https://media.test/take-1.mp4",
    })
  })

  it("an audio node writes only the index", () => {
    expect(pickSecond("text-to-speech", { generatedResults: results("mp3"), activeResultIndex: 0 })).toEqual({
      activeResultIndex: 1,
    })
  })
})

// A tile that cannot be picked carries its reason after its name.
const tile = (n: number) => screen.getByRole("button", { name: new RegExp(`^Result ${n}(?: — |$)`) })
const tileMedium = (n: number): "video" | "audio" | "image" | undefined =>
  tile(n).querySelector(".lucide-play") ? "video" : tile(n).querySelector(".lucide-music") ? "audio" : tile(n).querySelector("img") ? "image" : undefined

describe("Apply EDL — each take is shown as the medium of its own file", () => {
  // Rendered as audio (take 0), then Output switched to video and rendered again
  // (take 1): the history keeps both.
  const mixed = [
    { url: "https://media.test/take-1.mp4", timestamp: "2026-10-04T12:00:00.000Z", jobId: "job-1" },
    { url: "https://media.test/take-0.m4a", timestamp: "2026-10-04T11:00:00.000Z", jobId: "job-0" },
  ]

  it("tiles: the video take plays as video, the earlier audio take as audio", () => {
    renderGallery("apply-edl", { output: "video", generatedResults: mixed, activeResultIndex: 0 })
    expect(tileMedium(1)).toBe("video")
    expect(tileMedium(2)).toBe("audio")
  })

  it("a selected audio take saves to the Library as audio and is never offered as the workflow thumbnail", () => {
    renderGallery("apply-edl", { output: "video", generatedResults: mixed, activeResultIndex: 1 })
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "audio")
    expect(screen.queryByRole("button", { name: /Set as Thumbnail/i })).toBeNull()
  })

  it("a selected video take on a node switched to audio saves as video and can be the thumbnail", () => {
    renderGallery("apply-edl", { output: "audio", generatedResults: mixed, activeResultIndex: 0 })
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "video")
    expect(screen.getByRole("button", { name: /Set as Thumbnail/i })).toBeInTheDocument()
  })

  it("a take whose URL names no medium is shown as the node's Output", () => {
    expect(resultsGalleryTakeMedium("apply-edl", { output: "audio" }, "https://media.test/render?id=7")).toBe("audio")
    expect(resultsGalleryTakeMedium("apply-edl", {}, "https://media.test/render?id=7")).toBe("video")
    expect(resultsGalleryTakeMedium("apply-edl", { output: "video" }, "https://media.test/take-0.m4a")).toBe("audio")
  })
})

describe("Apply EDL — a take of the other medium than Output cannot be picked (decided 2026-10-04)", () => {
  // Rendered as audio (take 0), then Output switched to video and rendered
  // again (take 1). Passed on as the Output's medium, the audio take would fail
  // downstream on both engines.
  const mixed = [
    { url: "https://media.test/take-1.mp4", timestamp: "2026-10-04T12:00:00.000Z", jobId: "job-1" },
    { url: "https://media.test/take-0.m4a", timestamp: "2026-10-04T11:00:00.000Z", jobId: "job-0" },
  ]
  const AUDIO_REASON = "This take is audio — set Output to “Audio only” to use it"
  const VIDEO_REASON = "This take is video — set Output to “Video” to use it"

  it("video output: the audio take's tile is disabled, says why, and a click writes nothing", () => {
    const onUpdate = renderGallery("apply-edl", { output: "video", generatedResults: mixed, activeResultIndex: 0 })
    const refused = screen.getByRole("button", { name: `Result 2 — ${AUDIO_REASON}` })
    expect(refused).toHaveAttribute("aria-disabled", "true")
    expect(refused).toHaveAttribute("title", AUDIO_REASON)
    fireEvent.click(refused)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("audio output: the video take's tile is disabled, says why, and a click writes nothing", () => {
    const onUpdate = renderGallery("apply-edl", { output: "audio", generatedResults: mixed, activeResultIndex: 1 })
    const refused = screen.getByRole("button", { name: `Result 1 — ${VIDEO_REASON}` })
    expect(refused).toHaveAttribute("aria-disabled", "true")
    expect(refused).toHaveAttribute("title", VIDEO_REASON)
    fireEvent.click(refused)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("a take of the Output's medium stays pickable", () => {
    const onUpdate = renderGallery("apply-edl", { output: "audio", generatedResults: mixed, activeResultIndex: 0 })
    const allowed = screen.getByRole("button", { name: "Result 2" })
    expect(allowed).not.toHaveAttribute("aria-disabled")
    expect(allowed).not.toHaveAttribute("title")
    fireEvent.click(allowed)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ activeResultIndex: 1, generatedAudioUrl: "https://media.test/take-0.m4a" })
  })

  it("the pick write itself refuses it, so no caller can write an audio take as the video cut", () => {
    const data = { output: "video", generatedResults: mixed, activeResultIndex: 0 }
    expect(resultsGalleryPickRefusal("apply-edl", data, "https://media.test/take-0.m4a")).toBe("audio")
    expect(resultsGalleryPickPatch("apply-edl", data, "https://media.test/take-0.m4a", 1)).toBeUndefined()
    expect(resultsGalleryPickRefusal("apply-edl", { ...data, output: "audio" }, "https://media.test/take-1.mp4")).toBe("video")
    // A node saved before `output` existed renders video.
    expect(resultsGalleryPickRefusal("apply-edl", { generatedResults: mixed }, "https://media.test/take-0.m4a")).toBe("audio")
  })

  it("a take whose URL names no medium is taken to be the Output's, and never refused", () => {
    expect(resultsGalleryPickRefusal("apply-edl", { output: "video" }, "https://media.test/render?id=7")).toBeUndefined()
    expect(resultsGalleryPickRefusal("apply-edl", { output: "audio" }, "https://media.test/render?id=7")).toBeUndefined()
  })

  it("is Apply EDL's rule only: no other node type refuses a pick", () => {
    expect(resultsGalleryPickRefusal("voice-changer", { generatedVideoUrl: "https://media.test/take-1.mp4" }, "https://media.test/take-0.m4a")).toBeUndefined()
    expect(resultsGalleryPickRefusal("split-media", {}, "https://media.test/chunk-1.mp3")).toBeUndefined()
  })
})

describe("Apply EDL — a pick moves the Transcript output with the cut", () => {
  const cutA = { version: 1, words: [{ text: "back", startMs: 1310, endMs: 1650 }] }
  const cutB = { version: 1, words: [{ text: "back", startMs: 420, endMs: 760 }] }

  it("restores the Transcript the picked take was cut with (a render made by running the node on its own keeps it)", () => {
    const takes = [
      { url: "https://media.test/take-2.mp4", timestamp: "2026-10-04T12:00:00.000Z", jobId: "job-2", generatedJson: cutB },
      { url: "https://media.test/take-1.mp4", timestamp: "2026-10-04T11:00:00.000Z", jobId: "job-1", generatedJson: cutA },
    ]
    expect(pickSecond("apply-edl", { output: "video", generatedResults: takes, activeResultIndex: 0, generatedJson: cutB })).toStrictEqual({
      activeResultIndex: 1,
      generatedVideoUrl: "https://media.test/take-1.mp4",
      generatedAudioUrl: undefined,
      generatedJson: cutA,
    })
  })

  it("a take that kept no Transcript (a workflow run's) CLEARS the Transcript output: what it held is another cut's (decided 2026-10-04)", () => {
    // The gallery then reads the take's own back from its job, when that job is
    // provably this take's (apply-edl-picked-take.test.tsx, and
    // lib/__tests__/apply-edl-take-transcript.test.ts).
    const patch = pickSecond("apply-edl", { output: "video", generatedResults: results("mp4"), activeResultIndex: 0, generatedJson: cutB })
    expect(patch).toStrictEqual({
      activeResultIndex: 1,
      generatedVideoUrl: "https://media.test/take-1.mp4",
      generatedAudioUrl: undefined,
      generatedJson: undefined,
    })
  })
})

describe("a node whose medium is a setting: the pick writes what its own canvas picker writes", () => {
  it("voice-changer holding a video result (video mode): video tiles, the pick writes generatedVideoUrl", () => {
    const data = { generatedResults: results("mp4"), activeResultIndex: 0, generatedVideoUrl: "https://media.test/take-2.mp4", generatedAudioUrl: "https://media.test/take-2.mp3" }
    renderGallery("voice-changer", data)
    expect(tileMedium(1)).toBe("video")
    cleanup()
    expect(pickSecond("voice-changer", data)).toStrictEqual({ activeResultIndex: 1, generatedVideoUrl: "https://media.test/take-1.mp4" })
  })

  it("voice-changer and dubbing in audio mode: audio tiles, the pick writes generatedAudioUrl (the server reads it before the selected result)", () => {
    for (const nodeType of ["voice-changer", "dubbing"]) {
      const data = { generatedResults: results("mp3"), activeResultIndex: 0, generatedAudioUrl: "https://media.test/take-2.mp3" }
      renderGallery(nodeType, data)
      expect(tileMedium(1)).toBe("audio")
      cleanup()
      expect(pickSecond(nodeType, data)).toStrictEqual({ activeResultIndex: 1, generatedAudioUrl: "https://media.test/take-1.mp3" })
      cleanup()
    }
  })

  it("adjust-volume follows the input it last ran on", () => {
    expect(pickSecond("adjust-volume", { generatedResults: results("mp4"), activeResultIndex: 0, lastInputType: "video" })).toStrictEqual({
      activeResultIndex: 1,
      generatedVideoUrl: "https://media.test/take-1.mp4",
    })
    cleanup()
    expect(pickSecond("adjust-volume", { generatedResults: results("mp3"), activeResultIndex: 0, lastInputType: "audio" })).toStrictEqual({
      activeResultIndex: 1,
      generatedAudioUrl: "https://media.test/take-1.mp3",
    })
  })
})

describe("node types the hand-kept lists missed show the medium they produce", () => {
  it("trim-audio: audio tiles, Save to Library as audio, no thumbnail action, and no stray image field on a pick", () => {
    const data = { generatedResults: results("mp3"), activeResultIndex: 0 }
    renderGallery("trim-audio", data)
    expect(screen.queryByTestId("image-tile")).toBeNull()
    expect(tileMedium(1)).toBe("audio")
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "audio")
    expect(screen.queryByRole("button", { name: /Set as Thumbnail/i })).toBeNull()
    cleanup()
    expect(pickSecond("trim-audio", data)).toStrictEqual({ activeResultIndex: 1 })
  })

  it("trim-video: video tiles, Save to Library as video, and the pick writes generatedVideoUrl", () => {
    const data = { generatedResults: results("mp4"), activeResultIndex: 0 }
    renderGallery("trim-video", data)
    expect(tileMedium(1)).toBe("video")
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "video")
    cleanup()
    expect(pickSecond("trim-video", data)).toStrictEqual({ activeResultIndex: 1, generatedVideoUrl: "https://media.test/take-1.mp4" })
  })

  it("split-media: each chunk is shown as its own medium", () => {
    renderGallery("split-media", {
      generatedResults: [
        { url: "https://media.test/chunk-1.mp3", timestamp: "t", jobId: "j-1" },
        { url: "https://media.test/chunk-1.mp4", timestamp: "t", jobId: "j-2" },
      ],
      activeResultIndex: 0,
    })
    expect(tileMedium(1)).toBe("audio")
    expect(tileMedium(2)).toBe("video")
  })
})

// A node whose output medium follows its input sits in ONE shared producer set
// all the same: Social Media Format is a video producer, but reformats an image
// into an image (its worker uploads `.../images/<job>.png`). Each result is the
// file it is — its tile, Save to Library, Download and the field a pick writes
// — and the node type's medium is only the fallback for a URL that names none.
describe("each result is shown, saved and downloaded as the file it is", () => {
  const images = [
    { url: "https://media.test/images/job-2.png", timestamp: "2026-10-04T12:00:00.000Z", jobId: "job-2" },
    { url: "https://media.test/images/job-1.png", timestamp: "2026-10-04T11:00:00.000Z", jobId: "job-1" },
  ]

  it("social-media-format image results: image tiles, Save to Library as an image, a .png download", () => {
    downloadFile.mockClear()
    renderGallery("social-media-format", { generatedResults: images, activeResultIndex: 0 })
    expect(tileMedium(1)).toBe("image")
    expect(tileMedium(2)).toBe("image")
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "image")
    expect(screen.getByRole("button", { name: /Set as Thumbnail/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Download/i }))
    expect(downloadFile).toHaveBeenCalledWith("https://media.test/images/job-2.png", "social-media-format-result.png")
  })

  it("social-media-format image results: the pick writes generatedImageUrl, never generatedVideoUrl", () => {
    expect(pickSecond("social-media-format", { generatedResults: images, activeResultIndex: 0 })).toStrictEqual({
      activeResultIndex: 1,
      generatedImageUrl: "https://media.test/images/job-1.png",
    })
  })

  it("social-media-format video results: video tiles, Save to Library as video, a .mp4 download, and the pick writes generatedVideoUrl", () => {
    downloadFile.mockClear()
    const data = { generatedResults: results("mp4"), activeResultIndex: 0 }
    renderGallery("social-media-format", data)
    expect(tileMedium(1)).toBe("video")
    expect(screen.getByTestId("save-to-library")).toHaveAttribute("data-type", "video")
    fireEvent.click(screen.getByRole("button", { name: /Download/i }))
    expect(downloadFile).toHaveBeenCalledWith("https://media.test/take-2.mp4", "social-media-format-result.mp4")
    cleanup()
    expect(pickSecond("social-media-format", data)).toStrictEqual({ activeResultIndex: 1, generatedVideoUrl: "https://media.test/take-1.mp4" })
  })

  it("a result whose URL names no medium is shown as the node type's medium", () => {
    const bare = "https://media.test/render?id=7"
    expect(resultsGalleryTakeMedium("social-media-format", {}, bare)).toBe("video")
    expect(resultsGalleryTakeMedium("text-to-speech", {}, bare)).toBe("audio")
    expect(resultsGalleryTakeMedium("generate-image", {}, bare)).toBe("image")
    expect(resultsGalleryTakeMedium("component", {}, bare)).toBe("image")
  })
})

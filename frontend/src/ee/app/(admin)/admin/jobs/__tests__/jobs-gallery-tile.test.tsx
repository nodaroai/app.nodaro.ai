import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminJobsInfinite: vi.fn(),
}))

import { useAdminJobsInfinite, type AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { JobsGallery } from "../jobs-gallery"
import { DEFAULT_JOB_FILTERS } from "../jobs-filters"

function job(id: string, output_data: Record<string, unknown>, type = "generate-video"): AdminJob {
  return {
    id,
    user_email: "dana@x.test",
    credits: 1,
    created_at: new Date().toISOString(),
    status: "completed",
    output_data,
    input_data: { type },
    job_type: type,
  } as unknown as AdminJob
}

function renderGallery(jobs: AdminJob[]) {
  vi.mocked(useAdminJobsInfinite).mockReturnValue({
    data: { pages: [{ jobs }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  } as unknown as ReturnType<typeof useAdminJobsInfinite>)
  const onOpenJob = vi.fn()
  const utils = render(<JobsGallery filters={DEFAULT_JOB_FILTERS} onOpenJob={onOpenJob} />)
  return { ...utils, onOpenJob }
}

const tileOf = (id: string) => screen.getByTestId(`job-tile-${id}`)
const mediaIn = (id: string, tag: "video" | "audio") => tileOf(id).querySelector(tag) as HTMLMediaElement

// jsdom has no IntersectionObserver, and no media playback. The observer stub
// reports every target as on screen, so the lazily mounted <video> appears;
// play/pause are stubbed to emit the events a browser would.
const realIO = globalThis.IntersectionObserver
let playSpy: ReturnType<typeof vi.spyOn>
let pauseSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  globalThis.IntersectionObserver = class {
    constructor(private readonly cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver
  playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"))
    return Promise.resolve()
  })
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"))
  })
})

afterEach(() => {
  cleanup()
  globalThis.IntersectionObserver = realIO
  vi.restoreAllMocks()
})

describe("JobsGallery tiles", () => {
  it("shows a video, an audio cover, an image and text", () => {
    renderGallery([
      job("v1", { videoUrl: "https://x/v.mp4" }),
      job("a1", { audioUrl: "https://x/s.mp3", imageUrl: "https://x/c.jpg" }, "suno-voice-create"),
      job("i1", { imageUrl: "https://x/i.png" }, "generate-image"),
      job("t1", { generatedText: "Once upon a time" }, "llm-chat"),
    ])
    const video = mediaIn("v1", "video")
    expect(video).toHaveAttribute("src", "https://x/v.mp4#t=0.1")
    expect(video).toHaveAttribute("preload", "metadata")
    expect(video.muted).toBe(true)
    expect(tileOf("a1").querySelector("img")).toHaveAttribute("src", "https://x/c.jpg")
    expect(tileOf("i1").querySelector("img")).toHaveAttribute("src", "https://x/i.png")
    expect(tileOf("t1")).toHaveTextContent("Once upon a time")
  })

  it("single hover player", () => {
    renderGallery([job("A", { videoUrl: "https://x/a.mp4" }), job("B", { videoUrl: "https://x/b.mp4" })])
    const a = mediaIn("A", "video")
    const b = mediaIn("B", "video")

    fireEvent.pointerEnter(tileOf("A"))
    expect(playSpy.mock.contexts).toContain(a)
    a.currentTime = 3
    expect(a.currentTime).toBe(3)

    // Moving straight onto B (its enter can arrive before A's leave) stops A.
    fireEvent.pointerEnter(tileOf("B"))
    expect(playSpy.mock.contexts).toContain(b)
    expect(pauseSpy.mock.contexts).toContain(a)
    expect(a.currentTime).toBe(0)

    fireEvent.pointerLeave(tileOf("B"))
    expect(pauseSpy.mock.contexts).toContain(b)
  })

  it("single audio player", () => {
    renderGallery([
      job("A", { audioUrl: "https://x/a.mp3" }, "suno-voice-create"),
      job("B", { audioUrl: "https://x/b.mp3" }, "generate-dialogue"),
    ])
    const a = mediaIn("A", "audio")
    const b = mediaIn("B", "audio")
    const playA = screen.getByRole("button", { name: /play audio of job A/i })

    fireEvent.click(playA)
    expect(playSpy.mock.contexts).toContain(a)
    expect(screen.getByRole("button", { name: /pause audio of job A/i })).toBeInTheDocument()
    a.currentTime = 4

    fireEvent.click(screen.getByRole("button", { name: /play audio of job B/i }))
    expect(playSpy.mock.contexts).toContain(b)
    expect(pauseSpy.mock.contexts).toContain(a)
    expect(a.currentTime).toBe(0)
    // A's button follows its element back to "play".
    expect(screen.getByRole("button", { name: /play audio of job A/i })).toBeInTheDocument()
  })

  it("a hover preview never stops the audio someone started", () => {
    renderGallery([
      job("A", { audioUrl: "https://x/a.mp3" }, "suno-voice-create"),
      job("B", { videoUrl: "https://x/b.mp4" }),
      job("C", { audioUrl: "https://x/c.mp3" }, "generate-dialogue"),
    ])
    const a = mediaIn("A", "audio")
    fireEvent.click(screen.getByRole("button", { name: /play audio of job A/i }))
    a.currentTime = 2

    fireEvent.pointerEnter(tileOf("B"))
    fireEvent.pointerLeave(tileOf("B"))
    expect(playSpy.mock.contexts).toContain(mediaIn("B", "video"))
    expect(pauseSpy.mock.contexts).not.toContain(a)
    expect(a.currentTime).toBe(2)
    expect(screen.getByRole("button", { name: /pause audio of job A/i })).toBeInTheDocument()

    // Another track does stop it.
    fireEvent.click(screen.getByRole("button", { name: /play audio of job C/i }))
    expect(pauseSpy.mock.contexts).toContain(a)
    expect(a.currentTime).toBe(0)
  })

  it("the striped placeholder marks only a job with nothing to show", () => {
    renderGallery([
      job("N", {}),
      job("A", { audioUrl: "https://x/a.mp3" }, "generate-dialogue"),
      job("T", { generatedText: "Some text" }, "llm-chat"),
      job("V", { videoUrl: "https://x/v.mp4" }),
    ])
    const striped = (id: string) =>
      (tileOf(id).querySelector(".aspect-square")?.getAttribute("style") ?? "").includes("repeating-linear-gradient")
    expect(striped("N")).toBe(true)
    expect(striped("A")).toBe(false)
    expect(striped("T")).toBe(false)
    expect(striped("V")).toBe(false)
  })

  it("play button does not open the job", () => {
    const { onOpenJob } = renderGallery([job("A", { audioUrl: "https://x/a.mp3" }, "suno-voice-create")])
    fireEvent.click(screen.getByRole("button", { name: /play audio of job A/i }))
    expect(onOpenJob).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /open job A/i }))
    expect(onOpenJob).toHaveBeenCalledTimes(1)
  })

  it("stops a playing tile when it unmounts", () => {
    const { unmount } = renderGallery([job("A", { audioUrl: "https://x/a.mp3" }, "suno-voice-create")])
    const a = mediaIn("A", "audio")
    fireEvent.click(screen.getByRole("button", { name: /play audio of job A/i }))
    pauseSpy.mockClear()
    unmount()
    expect(pauseSpy.mock.contexts).toContain(a)
  })

  it("music jobs show the music icon, other audio the waveform", () => {
    renderGallery([
      job("M", { audioUrl: "https://x/m.mp3" }, "suno-voice-create"),
      job("S", { audioUrl: "https://x/s.mp3" }, "generate-dialogue"),
    ])
    expect(tileOf("M").querySelector(".lucide-music")).not.toBeNull()
    expect(tileOf("S").querySelector(".lucide-audio-lines")).not.toBeNull()
  })
})

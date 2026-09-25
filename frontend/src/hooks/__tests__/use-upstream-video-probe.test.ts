/**
 * The upstream video probe (spec §5.1, audit U3): a successful metadata read
 * caches duration AND display size on the node; a load error, a probe still
 * pending at the timeout, or metadata with no finite length caches a failure
 * marker, so "failed" is reachable
 * (Video Overlay's "Length unknown" state) instead of looking like "pending"
 * forever. The url guard stops a re-probe of the same url.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, renderHook } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { UPSTREAM_VIDEO_PROBE_TIMEOUT_MS, useUpstreamVideoProbe } from "../use-upstream-video-probe"

const URL_A = "https://cdn.example/a.mp4"

/** The <video> elements the hook creates, so a test can fire their events. */
let created: HTMLVideoElement[] = []
const realCreate = document.createElement.bind(document)

beforeEach(() => {
  created = []
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreate(tag)
    if (tag === "video") {
      vi.spyOn(el as HTMLVideoElement, "load").mockImplementation(() => {})
      created.push(el as HTMLVideoElement)
    }
    return el
  }) as typeof document.createElement)
  useWorkflowStore.setState({
    nodes: [
      { id: "src", type: "upload-video", position: { x: 0, y: 0 }, data: { url: URL_A } },
      { id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: { layers: [] } },
    ],
    edges: [{ id: "e", source: "src", target: "vo", sourceHandle: "video", targetHandle: "video" }],
  } as never)
})

afterEach(() => {
  cleanup() // unmount while the element spies are still in place
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function fire(el: HTMLVideoElement, type: string, props: Partial<Record<"duration" | "videoWidth" | "videoHeight", number>> = {}) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, value: v })
  el.dispatchEvent(new Event(type))
}

describe("useUpstreamVideoProbe", () => {
  it("caches duration and display size for the wired url", () => {
    const update = vi.fn()
    renderHook(() => useUpstreamVideoProbe("vo", "video", undefined, update))
    expect(created).toHaveLength(1)
    fire(created[0]!, "loadedmetadata", { duration: 12.4, videoWidth: 1080, videoHeight: 1920 })
    expect(update).toHaveBeenCalledWith("vo", { probedVideo: { url: URL_A, durationSec: 12.4, width: 1080, height: 1920 } })
  })

  it("a load error caches the failure marker", () => {
    const update = vi.fn()
    renderHook(() => useUpstreamVideoProbe("vo", "video", undefined, update))
    fire(created[0]!, "error")
    expect(update).toHaveBeenCalledWith("vo", { probedVideo: { url: URL_A, error: true } })
  })

  it("metadata with no finite length caches the failure marker and keeps the display size", () => {
    const update = vi.fn()
    renderHook(() => useUpstreamVideoProbe("vo", "video", undefined, update))
    fire(created[0]!, "loadedmetadata", { duration: Infinity, videoWidth: 640, videoHeight: 360 })
    expect(update).toHaveBeenCalledWith("vo", { probedVideo: { url: URL_A, error: true, width: 640, height: 360 } })
  })

  it("a probe still pending at the timeout caches the failure marker, once", () => {
    vi.useFakeTimers()
    const update = vi.fn()
    renderHook(() => useUpstreamVideoProbe("vo", "video", undefined, update))
    vi.advanceTimersByTime(UPSTREAM_VIDEO_PROBE_TIMEOUT_MS)
    fire(created[0]!, "loadedmetadata", { duration: 3 })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith("vo", { probedVideo: { url: URL_A, error: true } })
  })

  it("returns the cached duration only for the current url, and never re-probes it (a failure included)", () => {
    const update = vi.fn()
    const { result, rerender } = renderHook(({ probed }) => useUpstreamVideoProbe("vo", "video", probed, update), {
      initialProps: { probed: { url: URL_A, durationSec: 5 } as { url: string; durationSec?: number; error?: true } },
    })
    expect(result.current).toBe(5)
    rerender({ probed: { url: URL_A, error: true } })
    expect(result.current).toBeUndefined()
    rerender({ probed: { url: "https://cdn.example/old.mp4", durationSec: 9 } })
    expect(result.current).toBeUndefined()
    // Only the stale-url render asked for a fresh read.
    expect(created).toHaveLength(1)
  })
})

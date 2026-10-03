/**
 * Guards for the rendered look previews.
 *
 * - Every registered render belongs to an option the catalog still has (a
 *   renamed / removed option must not keep a picture that shows for nothing),
 *   and every URL is on the Nodaro CDN (the only host the resize transforms
 *   and the self-hosted-edition gate reason about).
 * - Nothing shows until a deployment registers sets: the package never reaches
 *   a CDN on its own, which is what keeps self-hosted editions CDN-free.
 * - LookArt: the registered render, the fallback without one or on a load
 *   error, the fill-not-grow sizing, and the looping clip over its still for
 *   video renders — on screen only, never under reduced motion.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PICKER_CATALOGS } from "@nodaro/prompts"
import { StrictMode } from "react"
import { LookArt } from "../look-art"
import { cdnVideoUrl, isVideoPreview } from "../media-url"
import { getLookPreviewUrl, hasLookPreviews, registerLookPreviews, resetLookPreviewsForTests } from "../registry"
import { LOOK_PREVIEW_SETS } from "../sets"

// jsdom has no media pipeline: stub the three HTMLMediaElement methods the clip
// uses, counting calls, so playback start and resource release are observable.
let playCalls = 0
let pauseCalls = 0
let loadCalls = 0
let playImpl: () => Promise<void> = () => Promise.resolve()
const originalMatchMedia = window.matchMedia
beforeEach(() => {
  playCalls = 0
  pauseCalls = 0
  loadCalls = 0
  playImpl = () => Promise.resolve()
  HTMLMediaElement.prototype.play = function () {
    playCalls += 1
    return playImpl()
  }
  HTMLMediaElement.prototype.pause = function () {
    pauseCalls += 1
  }
  HTMLMediaElement.prototype.load = function () {
    loadCalls += 1
  }
})
afterEach(() => {
  resetLookPreviewsForTests()
  window.matchMedia = originalMatchMedia
})

function catalogIds(nodeType: string): ReadonlySet<string> {
  const catalog = PICKER_CATALOGS.find((c) => c.nodeType === nodeType)
  if (!catalog) throw new Error(`no picker catalog for "${nodeType}"`)
  const options = [...(catalog.options ?? []), ...(catalog.dimensions ?? []).flatMap((d) => d.options)]
  return new Set(options.map((o) => o.id))
}

describe("look preview sets", () => {
  it.each(Object.keys(LOOK_PREVIEW_SETS))("%s: every render belongs to an option the catalog has", (key) => {
    const ids = catalogIds(key)
    const stale = Object.keys(LOOK_PREVIEW_SETS[key as keyof typeof LOOK_PREVIEW_SETS]).filter((id) => !ids.has(id))
    expect(stale).toEqual([])
  })

  it("every render is a Nodaro CDN image, or a CDN video for camera motion", () => {
    const bad: string[] = []
    for (const [key, set] of Object.entries(LOOK_PREVIEW_SETS)) {
      for (const [id, url] of Object.entries(set as Record<string, string>)) {
        const ok = key === "camera-motion"
          ? /^https:\/\/cdn\.nodaro\.ai\/videos\/[0-9a-f-]+\.mp4$/.test(url)
          : /^https:\/\/cdn\.nodaro\.ai\/images\/[0-9a-f-]+\.png$/.test(url)
        if (!ok) bad.push(`${key}.${id}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe("look preview registry", () => {
  it("shows nothing until a deployment registers sets", () => {
    expect(getLookPreviewUrl("style", "anime")).toBeUndefined()
    expect(hasLookPreviews("style")).toBe(false)
    registerLookPreviews(LOOK_PREVIEW_SETS)
    expect(getLookPreviewUrl("style", "anime")).toBe(LOOK_PREVIEW_SETS.style.anime)
    expect(hasLookPreviews("style")).toBe(true)
  })
})

describe("LookArt", () => {
  const fallback = <span data-testid="drawn">drawn</span>

  it("renders the fallback when nothing is registered", () => {
    render(<LookArt pickerKey="style" id="anime" fallback={fallback} />)
    expect(screen.getByTestId("drawn")).toBeInTheDocument()
  })

  it("renders the registered render through the CDN resize, filling without growing its box", () => {
    registerLookPreviews({ style: { anime: "https://cdn.nodaro.ai/images/abc.png" } })
    const { container } = render(<LookArt pickerKey="style" id="anime" width={240} fallback={fallback} />)
    const img = container.querySelector("img")!
    expect(screen.queryByTestId("drawn")).toBeNull()
    expect(img.getAttribute("src")).toContain("/cdn-cgi/image/width=240")
    expect(img.getAttribute("srcset")).toContain("width=240")
    expect(img.getAttribute("srcset")).toContain("width=960")
    const offered = [...(img.getAttribute("srcset") ?? "").matchAll(/width=(\d+)/g)].map((m) => Number(m[1]))
    expect(offered.every((w) => [240, 480, 960, 1920].includes(w))).toBe(true)
    expect(img.style.width).toBe("0px")
    expect(img.style.minWidth).toBe("100%")
  })

  it("falls back to the drawn preview when the render fails to load", () => {
    registerLookPreviews({ style: { anime: "https://cdn.nodaro.ai/images/abc.png" } })
    const { container } = render(<LookArt pickerKey="style" id="anime" fallback={fallback} />)
    fireEvent.error(container.querySelector("img")!)
    expect(screen.getByTestId("drawn")).toBeInTheDocument()
  })

  it("loops a clip over its still, silently, from the moment it is shown", () => {
    const clip = "https://cdn.nodaro.ai/videos/abc.mp4"
    registerLookPreviews({ "camera-motion": { "dolly-in": clip } })
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    const still = container.querySelector("img")!
    expect(still.getAttribute("src")).toContain("/cdn-cgi/media/mode=frame")
    const video = container.querySelector("video")!
    expect(video.getAttribute("src")).toContain("/cdn-cgi/media/mode=video")
    expect(video.getAttribute("src")).toContain("audio=false")
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.playsInline).toBe(true)
    // Started from an effect (not the autoplay attribute), so a refusal can be caught.
    expect(video.autoplay).toBe(false)
    expect(playCalls).toBe(1)
    // The still stays underneath: the box is never blank while the clip loads.
    expect(still.parentElement).toBe(video.parentElement)
  })

  it("swaps the clip when the option changes", () => {
    const a = "https://cdn.nodaro.ai/videos/aaa.mp4"
    const b = "https://cdn.nodaro.ai/videos/bbb.mp4"
    registerLookPreviews({ "camera-motion": { "dolly-in": a, "dolly-out": b } })
    const { container, rerender } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={null} />)
    expect(container.querySelector("video")!.getAttribute("src")).toContain("aaa.mp4")
    rerender(<LookArt pickerKey="camera-motion" id="dolly-out" fallback={null} />)
    expect(container.querySelector("video")!.getAttribute("src")).toContain("bbb.mp4")
  })

  it("keeps the still when the clip fails to load, and retries on another option", () => {
    const a = "https://cdn.nodaro.ai/videos/aaa.mp4"
    const b = "https://cdn.nodaro.ai/videos/bbb.mp4"
    registerLookPreviews({ "camera-motion": { "dolly-in": a, "dolly-out": b } })
    const { container, rerender } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    fireEvent.error(container.querySelector("video")!)
    expect(container.querySelector("video")).toBeNull()
    expect(container.querySelector("img")).not.toBeNull()
    expect(screen.queryByTestId("drawn")).toBeNull()
    rerender(<LookArt pickerKey="camera-motion" id="dolly-out" fallback={fallback} />)
    expect(container.querySelector("video")!.getAttribute("src")).toContain("bbb.mp4")
  })

  it("keeps the still when the browser refuses to play (iOS Low Power Mode)", async () => {
    playImpl = () => Promise.reject(new DOMException("denied", "NotAllowedError"))
    registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    await waitFor(() => expect(container.querySelector("video")).toBeNull())
    expect(container.querySelector("img")).not.toBeNull()
  })

  it("shows the still only in an icon-size slot (under 48px on screen)", () => {
    let callback: ((entries: Array<{ contentRect: { width: number } }>) => void) | undefined
    class FakeResize {
      constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
        callback = cb
      }
      observe() {}
      disconnect() {}
    }
    const g = globalThis as unknown as { ResizeObserver?: unknown }
    const original = g.ResizeObserver
    g.ResizeObserver = FakeResize
    try {
      registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
      const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" width={160} fallback={fallback} />)
      // The box measures 16px (a dropdown item icon): still only.
      act(() => callback!([{ contentRect: { width: 16 } }]))
      expect(container.querySelector("img")).not.toBeNull()
      expect(container.querySelector("video")).toBeNull()
      // The same LookArt laid out at 56px (the app card's button): the clip loops.
      act(() => callback!([{ contentRect: { width: 56 } }]))
      expect(container.querySelector("video")).not.toBeNull()
    } finally {
      g.ResizeObserver = original
    }
  })

  it("survives StrictMode's dev double-invoke with its src intact", () => {
    registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
    const { container } = render(
      <StrictMode>
        <LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />
      </StrictMode>,
    )
    const video = container.querySelector("video")!
    expect(video.getAttribute("src")).toContain("abc.mp4")
    // setup → cleanup (release) → setup (play again, src restored)
    expect(pauseCalls).toBe(1)
    expect(playCalls).toBe(2)
  })

  it("releases the media resource when the clip unmounts", () => {
    registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
    const { container, unmount } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    const video = container.querySelector("video")!
    unmount()
    expect(pauseCalls).toBe(1)
    expect(loadCalls).toBe(1)
    expect(video.getAttribute("src")).toBeNull()
  })

  it("shows only the still under reduced motion, live", () => {
    const listeners = new Set<() => void>()
    let reduced = true
    window.matchMedia = ((query: string) => ({
      get matches() {
        return reduced && query.includes("prefers-reduced-motion")
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    })) as unknown as typeof window.matchMedia
    registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    expect(container.querySelector("img")).not.toBeNull()
    expect(container.querySelector("video")).toBeNull()
    // The OS setting is turned off while the tile is on screen: the clip starts.
    reduced = false
    act(() => listeners.forEach((l) => l()))
    expect(container.querySelector("video")).not.toBeNull()
    reduced = true
    act(() => listeners.forEach((l) => l()))
    expect(container.querySelector("video")).toBeNull()
  })

  it("mounts the clip only while the tile is on screen, and retries a failed clip on re-entry", () => {
    let callback: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    const observed: Element[] = []
    class FakeObserver {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void, opts?: { rootMargin?: string; scrollMargin?: string }) {
        callback = cb
        // The viewport lead, and the same lead inside nested scrollers.
        expect(opts?.rootMargin).toBe("200px")
        expect(opts?.scrollMargin).toBe("200px")
      }
      observe(el: Element) {
        observed.push(el)
      }
      disconnect() {}
    }
    const g = globalThis as unknown as { IntersectionObserver?: unknown }
    const original = g.IntersectionObserver
    g.IntersectionObserver = FakeObserver
    try {
      registerLookPreviews({ "camera-motion": { "dolly-in": "https://cdn.nodaro.ai/videos/abc.mp4" } })
      const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
      // Off screen: the still alone.
      expect(container.querySelector("img")).not.toBeNull()
      expect(container.querySelector("video")).toBeNull()
      expect(observed[0]).toBe(container.querySelector("img")!.parentElement)
      act(() => callback!([{ isIntersecting: true }]))
      expect(container.querySelector("video")).not.toBeNull()
      // A leave and an enter delivered together: the LAST entry wins.
      act(() => callback!([{ isIntersecting: true }, { isIntersecting: false }]))
      expect(container.querySelector("video")).toBeNull()
      act(() => callback!([{ isIntersecting: false }, { isIntersecting: true }]))
      expect(container.querySelector("video")).not.toBeNull()
      // A clip that fails is retried the next time the tile comes on screen.
      fireEvent.error(container.querySelector("video")!)
      expect(container.querySelector("video")).toBeNull()
      act(() => callback!([{ isIntersecting: false }]))
      act(() => callback!([{ isIntersecting: true }]))
      expect(container.querySelector("video")).not.toBeNull()
    } finally {
      g.IntersectionObserver = original
    }
  })
})

describe("media-url", () => {
  it("recognises clip renders", () => {
    expect(isVideoPreview("https://cdn.nodaro.ai/videos/a.mp4")).toBe(true)
    expect(isVideoPreview("https://cdn.nodaro.ai/images/a.png")).toBe(false)
  })

  it("only transforms Nodaro CDN videos, never twice", () => {
    const once = cdnVideoUrl("https://cdn.nodaro.ai/videos/a.mp4", { mode: "video", width: 420 })
    expect(once).toBe("https://cdn.nodaro.ai/cdn-cgi/media/mode=video,width=420,audio=false/videos/a.mp4")
    expect(cdnVideoUrl(once, { mode: "video", width: 640 })).toBe(once)
    expect(cdnVideoUrl("https://example.com/a.mp4", { mode: "frame", width: 240 })).toBe("https://example.com/a.mp4")
  })
})

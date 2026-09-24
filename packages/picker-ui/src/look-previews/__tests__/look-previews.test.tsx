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
 *   error, the fill-not-grow sizing, and still + hover clip for video renders.
 */
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PICKER_CATALOGS } from "@nodaro/prompts"
import { LookArt } from "../look-art"
import { cdnVideoUrl, isVideoPreview } from "../media-url"
import { getLookPreviewUrl, hasLookPreviews, registerLookPreviews, resetLookPreviewsForTests } from "../registry"
import { LOOK_PREVIEW_SETS } from "../sets"

afterEach(() => resetLookPreviewsForTests())

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

  it("shows a still for a clip and plays it only while hovered", () => {
    const clip = "https://cdn.nodaro.ai/videos/abc.mp4"
    registerLookPreviews({ "camera-motion": { "dolly-in": clip } })
    const { container } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={fallback} />)
    const still = container.querySelector("img")!
    expect(still.getAttribute("src")).toContain("/cdn-cgi/media/mode=frame")
    expect(container.querySelector("video")).toBeNull()
    fireEvent.pointerEnter(still.parentElement!, { pointerType: "mouse" })
    const video = container.querySelector("video")!
    expect(video.getAttribute("src")).toContain("/cdn-cgi/media/mode=video")
    expect(video.muted).toBe(true)
    fireEvent.pointerLeave(still.parentElement!)
    expect(container.querySelector("video")).toBeNull()
  })
})

it("a touch never starts a clip, and a clip stops when its option changes mid-hover", () => {
  const a = "https://cdn.nodaro.ai/videos/aaa.mp4"
  const b = "https://cdn.nodaro.ai/videos/bbb.mp4"
  registerLookPreviews({ "camera-motion": { "dolly-in": a, "dolly-out": b } })
  const { container, rerender } = render(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={null} />)
  const box = () => container.querySelector("img")!.parentElement!
  fireEvent.pointerEnter(box(), { pointerType: "touch" })
  expect(container.querySelector("video")).toBeNull()
  fireEvent.pointerEnter(box(), { pointerType: "mouse" })
  expect(container.querySelector("video")).not.toBeNull()
  rerender(<LookArt pickerKey="camera-motion" id="dolly-out" fallback={null} />)
  expect(container.querySelector("video")).toBeNull()
  rerender(<LookArt pickerKey="camera-motion" id="dolly-in" fallback={null} />)
  expect(container.querySelector("video")).toBeNull()
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

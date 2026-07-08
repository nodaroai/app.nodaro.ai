import { describe, it, expect, beforeAll } from "vitest"
import { render } from "@testing-library/react"
import { PreviewVideo } from "../preview-video"

// jsdom has no IntersectionObserver; PreviewVideo constructs one in an effect.
// A no-op stub lets the component mount without the observer ever firing — so
// `src` stays unattached until hover/intersection, exactly as in the browser.
beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.IntersectionObserver
  }
})

describe("PreviewVideo", () => {
  it("uses preload=metadata so the first frame is visible without hover", () => {
    // Regression guard: the old preload="none" left the tile blank until hover
    // (the reported bug). "metadata" makes the browser paint frame 0 — the same
    // frame the gallery's ffmpeg poster (`-ss 0`) uses.
    const { container } = render(<PreviewVideo src="https://cdn.nodaro.ai/videos/x.mp4" />)
    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute("preload", "metadata")
  })

  it("omits the poster attribute when no poster is provided (first-frame fallback)", () => {
    const { container } = render(<PreviewVideo src="https://cdn.nodaro.ai/videos/x.mp4" />)
    expect(container.querySelector("video")).not.toHaveAttribute("poster")
  })

  it("shows an optimized poster still-frame when a poster URL is provided", () => {
    const { container } = render(
      <PreviewVideo
        src="https://cdn.nodaro.ai/videos/x.mp4"
        poster="https://cdn.nodaro.ai/thumbnails/x.png"
      />,
    )
    const poster = container.querySelector("video")?.getAttribute("poster") ?? ""
    // Routed through optimizedImageUrl → Cloudflare image transform on our CDN.
    expect(poster).toContain("/cdn-cgi/image/")
    expect(poster).toContain("width=768")
    expect(poster).toContain("/thumbnails/x.png")
  })
})

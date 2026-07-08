import { describe, it, expect, beforeAll } from "vitest"
import { render } from "@testing-library/react"
import { WorkflowThumbnail } from "../workflow-thumbnail"

// PreviewVideo (used for video thumbnails) constructs an IntersectionObserver
// in an effect; jsdom has none, so stub a no-op.
beforeAll(() => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.IntersectionObserver
  }
})

describe("WorkflowThumbnail", () => {
  it("renders a video thumbnail with preload=metadata (visible without hover, not blank)", () => {
    // Regression guard for the reported bug: the video tile must paint frame 0
    // (preload=metadata via PreviewVideo), NOT sit blank behind preload=none.
    const { container } = render(
      <WorkflowThumbnail thumbnailUrl="https://cdn.nodaro.ai/videos/wf.mp4" />,
    )
    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute("preload", "metadata")
  })

  it("renders an image (not a video) for image thumbnails", () => {
    const { container } = render(
      <WorkflowThumbnail thumbnailUrl="https://cdn.nodaro.ai/images/wf.png" />,
    )
    expect(container.querySelector("video")).toBeNull()
    expect(container.querySelector("img")).not.toBeNull()
  })

  it("renders a placeholder when there is no thumbnail", () => {
    const { container } = render(<WorkflowThumbnail thumbnailUrl={null} />)
    expect(container.querySelector("video")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
  })

  it("prioritizes the fetch for above-the-fold (priority) image thumbnails", () => {
    // LCP hygiene: the first row of a grid is the LCP candidate, so its image
    // must fetch immediately at high priority instead of the browser's default
    // "Low until layout" treatment. Guards the fetchpriority/eager propagation.
    const { container } = render(
      <WorkflowThumbnail thumbnailUrl="https://cdn.nodaro.ai/images/wf.png" priority />,
    )
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute("fetchpriority", "high")
    expect(img).toHaveAttribute("loading", "eager")
    expect(img).toHaveAttribute("decoding", "async")
  })

  it("does not force high priority for below-the-fold image thumbnails", () => {
    // Marking every image high-priority defeats prioritization, so the default
    // (no priority prop) must NOT set fetchpriority.
    const { container } = render(
      <WorkflowThumbnail thumbnailUrl="https://cdn.nodaro.ai/images/wf.png" />,
    )
    const img = container.querySelector("img")
    expect(img).not.toBeNull()
    expect(img).not.toHaveAttribute("fetchpriority", "high")
  })
})

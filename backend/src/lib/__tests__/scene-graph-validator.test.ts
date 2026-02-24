import { describe, it, expect } from "vitest"
import { validateSceneGraph } from "../scene-graph-validator.js"

// Helper to build a minimal valid scene graph
function makeValidSceneGraph(overrides: Record<string, unknown> = {}) {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    tracks: [
      {
        type: "media",
        id: "track-1",
        zIndex: 0,
        segments: [
          {
            id: "seg-1",
            src: "https://example.com/image.jpg",
            mediaType: "image",
            startFrame: 0,
            durationInFrames: 300,
            layout: { mode: "fullscreen" },
            effects: [],
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("validateSceneGraph", () => {
  it("accepts a valid scene graph", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph(),
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.sceneGraph).not.toBeNull()
  })

  it("returns errors for missing tracks", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph({ tracks: [] }),
      [],
      300,
      30,
    )
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("auto-fixes fps when different from expected", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph({ fps: 24 }),
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(true)
    expect(result.sceneGraph!.fps).toBe(30)
    expect(result.autoFixed).toContainEqual(expect.stringContaining("fps"))
  })

  it("auto-fixes duration within 10% tolerance", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph({ durationInFrames: 310 }),
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(true)
    expect(result.sceneGraph!.durationInFrames).toBe(300)
    expect(result.autoFixed).toContainEqual(expect.stringContaining("durationInFrames"))
  })

  it("reports error when duration exceeds 10% tolerance", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph({ durationInFrames: 500 }),
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining("duration"))
  })

  it("reports segment overlap errors", () => {
    const sg = makeValidSceneGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 0,
          segments: [
            {
              id: "seg-1",
              src: "https://example.com/a.jpg",
              mediaType: "image",
              startFrame: 0,
              durationInFrames: 200,
              layout: { mode: "fullscreen" },
              effects: [],
            },
            {
              id: "seg-2",
              src: "https://example.com/b.jpg",
              mediaType: "image",
              startFrame: 100,
              durationInFrames: 200,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(
      sg,
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining("overlap"))
  })

  it("auto-fixes invalid text animation to fade", () => {
    const sg = makeValidSceneGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 0,
          segments: [
            {
              id: "seg-1",
              src: "https://example.com/image.jpg",
              mediaType: "image",
              startFrame: 0,
              durationInFrames: 300,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
        {
          type: "text",
          id: "track-2",
          zIndex: 1,
          segments: [
            {
              id: "txt-1",
              text: "Hello",
              startFrame: 0,
              durationInFrames: 100,
              position: "center",
              fontSize: 48,
              color: "#ffffff",
              animation: "bounce",
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(
      sg,
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(true)
    expect(result.autoFixed).toContainEqual(expect.stringContaining("bounce"))
  })

  it("reports unreferenced assets", () => {
    const result = validateSceneGraph(
      makeValidSceneGraph(),
      ["https://example.com/image.jpg", "https://example.com/unused.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining("unused.jpg"))
  })

  it("returns Zod errors for fundamentally invalid data", () => {
    const result = validateSceneGraph("not an object", [], 300, 30)
    expect(result.valid).toBe(false)
    expect(result.sceneGraph).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rounds fractional frame numbers", () => {
    const sg = makeValidSceneGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 0,
          segments: [
            {
              id: "seg-1",
              src: "https://example.com/image.jpg",
              mediaType: "image",
              startFrame: 0.7,
              durationInFrames: 299.3,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(
      sg,
      ["https://example.com/image.jpg"],
      300,
      30,
    )
    expect(result.valid).toBe(true)
    const seg = (result.sceneGraph!.tracks[0] as any).segments[0]
    expect(seg.startFrame).toBe(1)
    expect(seg.durationInFrames).toBe(299)
  })
})

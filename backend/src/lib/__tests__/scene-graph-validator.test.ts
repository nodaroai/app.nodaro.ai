import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { validateSceneGraph } from "@/lib/scene-graph-validator.js"

const IMG_URL = "https://example.com/img.png"
const AUDIO_URL = "https://example.com/audio.mp3"
const EXPECTED_FPS = 30
const EXPECTED_DURATION = 300

function makeValidGraph(overrides: Record<string, unknown> = {}) {
  return {
    fps: EXPECTED_FPS,
    width: 1920,
    height: 1080,
    durationInFrames: EXPECTED_DURATION,
    backgroundColor: "#000000",
    tracks: [
      {
        type: "media",
        id: "track-1",
        zIndex: 1,
        segments: [
          {
            id: "seg-1",
            src: IMG_URL,
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
    const result = validateSceneGraph(makeValidGraph(), [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(true)
    expect(result.sceneGraph).not.toBeNull()
    expect(result.errors).toEqual([])
  })

  it("rejects when tracks array is missing", () => {
    const graph = makeValidGraph()
    delete (graph as Record<string, unknown>).tracks
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("rejects when tracks array is empty", () => {
    const graph = makeValidGraph({ tracks: [] })
    const result = validateSceneGraph(graph, [], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("tracks"))).toBe(true)
  })

  it("rejects invalid track type", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "special-fx",
          id: "track-bad",
          zIndex: 1,
          segments: [],
        },
      ],
    })
    const result = validateSceneGraph(graph, [], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("auto-fixes invalid text animation to 'fade'", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 1,
          segments: [
            {
              id: "seg-1",
              src: IMG_URL,
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
          id: "track-text",
          zIndex: 2,
          segments: [
            {
              id: "text-seg-1",
              text: "Hello World",
              startFrame: 0,
              durationInFrames: 90,
              position: "center",
              fontSize: 48,
              color: "#ffffff",
              animation: "bounce",
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.sceneGraph).not.toBeNull()
    const textTrack = result.sceneGraph!.tracks.find((t) => t.type === "text")
    expect(textTrack).toBeDefined()
    if (textTrack && textTrack.type === "text") {
      expect(textTrack.segments[0].animation).toBe("fade")
    }
    expect(result.autoFixed.some((f) => f.includes("bounce") && f.includes("fade"))).toBe(true)
  })

  it("auto-fixes fps when slightly off", () => {
    const graph = makeValidGraph({ fps: 25 })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.sceneGraph!.fps).toBe(EXPECTED_FPS)
    expect(result.autoFixed.some((f) => f.includes("fps") && f.includes("25") && f.includes("30"))).toBe(true)
  })

  it("auto-fixes duration within 10% tolerance", () => {
    // 10% of 300 = 30, so 320 is within tolerance
    const graph = makeValidGraph({ durationInFrames: 320 })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(true)
    expect(result.sceneGraph!.durationInFrames).toBe(EXPECTED_DURATION)
    expect(result.autoFixed.some((f) => f.includes("durationInFrames") && f.includes("320") && f.includes("300"))).toBe(true)
  })

  it("reports error when duration exceeds 10% tolerance", () => {
    // 10% of 300 = 30, tolerance = ceil(30) = 30, so 331 is beyond (diff = 31 > 30)
    const graph = makeValidGraph({ durationInFrames: 331 })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("duration") && e.includes("10%"))).toBe(true)
    // Should NOT be in autoFixed since it was too far off
    expect(result.autoFixed.some((f) => f.includes("durationInFrames"))).toBe(false)
  })

  it("reports missing asset references", () => {
    const missingUrl = "https://example.com/missing.png"
    const result = validateSceneGraph(makeValidGraph(), [IMG_URL, missingUrl], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes(missingUrl))).toBe(true)
  })

  it("detects segment overlap in media tracks", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 1,
          segments: [
            {
              id: "seg-1",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 0,
              durationInFrames: 200,
              layout: { mode: "fullscreen" },
              effects: [],
            },
            {
              id: "seg-2",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 150,
              durationInFrames: 150,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("overlap") && e.includes("seg-1") && e.includes("seg-2"))).toBe(true)
  })

  it("rounds non-integer frames in media segments", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 1,
          segments: [
            {
              id: "seg-1",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 0.4,
              durationInFrames: 299.7,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.sceneGraph).not.toBeNull()
    const seg = (result.sceneGraph!.tracks[0] as { type: "media"; segments: Array<{ startFrame: number; durationInFrames: number }> }).segments[0]
    expect(seg.startFrame).toBe(0)
    expect(seg.durationInFrames).toBe(300)
    expect(result.autoFixed.some((f) => f.includes("Rounded") && f.includes("seg-1"))).toBe(true)
  })

  it("handles all three track types (media, audio, text)", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "media",
          id: "track-media",
          zIndex: 1,
          segments: [
            {
              id: "seg-media",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 0,
              durationInFrames: 300,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
        {
          type: "audio",
          id: "track-audio",
          src: AUDIO_URL,
          volume: 0.8,
          fadeInFrames: 10,
          fadeOutFrames: 10,
        },
        {
          type: "text",
          id: "track-text",
          zIndex: 2,
          segments: [
            {
              id: "text-seg",
              text: "Title",
              startFrame: 0,
              durationInFrames: 90,
              position: "top",
              fontSize: 64,
              color: "#ffffff",
              animation: "fade",
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(graph, [IMG_URL, AUDIO_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(true)
    expect(result.sceneGraph!.tracks).toHaveLength(3)
  })

  it("does not report overlap for sequential non-overlapping segments", () => {
    const graph = makeValidGraph({
      tracks: [
        {
          type: "media",
          id: "track-1",
          zIndex: 1,
          segments: [
            {
              id: "seg-1",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 0,
              durationInFrames: 150,
              layout: { mode: "fullscreen" },
              effects: [],
            },
            {
              id: "seg-2",
              src: IMG_URL,
              mediaType: "image",
              startFrame: 150,
              durationInFrames: 150,
              layout: { mode: "fullscreen" },
              effects: [],
            },
          ],
        },
      ],
    })
    const result = validateSceneGraph(graph, [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.errors.filter((e) => e.includes("overlap"))).toHaveLength(0)
  })

  it("reports audio asset not referenced", () => {
    const result = validateSceneGraph(makeValidGraph(), [IMG_URL, AUDIO_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes(AUDIO_URL))).toBe(true)
  })

  it("returns no autoFixed when graph matches expectations exactly", () => {
    const result = validateSceneGraph(makeValidGraph(), [IMG_URL], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.autoFixed).toEqual([])
  })

  it("rejects non-object input", () => {
    const result = validateSceneGraph("not valid", [], EXPECTED_DURATION, EXPECTED_FPS)
    expect(result.valid).toBe(false)
    expect(result.sceneGraph).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

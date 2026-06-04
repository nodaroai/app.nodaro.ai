import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  videoNodeSizing,
  imageNodeSizing,
  VIDEO_NODE_MIN_WIDTH,
  VIDEO_NODE_MIN_HEIGHT,
  VIDEO_NODE_DEFAULT_ASPECT,
} from "../video-node-defaults"

const NODE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")
const nodeFiles = readdirSync(NODE_DIR).filter((f) => f.endsWith("-node.tsx"))

const usesHelper = (src: string) => /(videoNodeSizing|imageNodeSizing)\(/.test(src)

// A node is "media-sized" if it derives size from a result aspect ratio
// (`useResultAspectRatio`) or already routes through the shared helper. Every
// such node MUST size via the helper — that's what makes all video and image
// nodes share one sizing characteristic and stops per-node size drift.
const mediaNodeFiles = nodeFiles.filter((f) => {
  const src = readFileSync(join(NODE_DIR, f), "utf8")
  return src.includes("useResultAspectRatio") || usesHelper(src)
})

describe("all video & image nodes share one sizing characteristic", () => {
  it("scans the full media-node set", () => {
    // 22 video + 10 image + upload-video + manual-edit + youtube-video = 36.
    // Floored a little below to tolerate benign churn; the per-file asserts
    // below are the real guard.
    expect(mediaNodeFiles.length).toBeGreaterThanOrEqual(34)
  })

  for (const file of mediaNodeFiles) {
    const src = readFileSync(join(NODE_DIR, file), "utf8")
    it(`${file} sizes via the shared helper, with no hand-picked sizing`, () => {
      // Routes through videoNodeSizing()/imageNodeSizing().
      expect(usesHelper(src)).toBe(true)
      // The helper supplies imageAspectRatio + the old per-node floors, so a
      // node must not also pass them itself (a leftover = unconverted drift).
      expect(src).not.toMatch(/imageAspectRatio=\{/)
      expect(src).not.toMatch(/minWidth=\{(200|220)\}/)
    })
  }
})

describe("the shared sizing helpers", () => {
  it("video and image agree given the same aspect (one characteristic)", () => {
    const a = 4 / 3
    expect(imageNodeSizing(a, undefined)).toEqual(videoNodeSizing(a))
  })

  it("idle video defaults to 16:9 at the shared min size", () => {
    const s = videoNodeSizing(undefined)
    expect(s.imageAspectRatio).toBe(VIDEO_NODE_DEFAULT_ASPECT)
    expect(s.minHeight).toBe(VIDEO_NODE_MIN_HEIGHT)
    expect(s.minWidth).toBe(VIDEO_NODE_MIN_WIDTH)
  })

  it("image aspect falls back result → upstream → 16:9", () => {
    expect(imageNodeSizing(2, 1).imageAspectRatio).toBe(2) // result wins
    expect(imageNodeSizing(undefined, 1).imageAspectRatio).toBe(1) // upstream image
    expect(imageNodeSizing(undefined, undefined).imageAspectRatio).toBe(VIDEO_NODE_DEFAULT_ASPECT) // 16:9
  })

  it("a portrait result stays correctly proportioned (height, not width, is the lever)", () => {
    const portrait = 9 / 16
    const s = videoNodeSizing(portrait)
    // width floor stays at the min; height grows past the floor for tall media
    expect(s.minWidth).toBe(VIDEO_NODE_MIN_WIDTH)
    expect(s.minHeight).toBe(Math.round(VIDEO_NODE_MIN_WIDTH / portrait))
    expect(s.minHeight).toBeGreaterThan(VIDEO_NODE_MIN_HEIGHT)
  })
})

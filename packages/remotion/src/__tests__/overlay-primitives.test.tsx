import { describe, it, expect, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Caption } from "@remotion/captions"

vi.mock("remotion", async () => ({
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
  spring: ({ frame }: { frame: number }) => Math.min(1, frame / 30),
  interpolate: (v: number, [a, b]: [number, number], [c, d]: [number, number]) => {
    if (v <= a) return c
    if (v >= b) return d
    return c + (v - a) / (b - a) * (d - c)
  },
  OffthreadVideo: ({ src }: { src: string }) => <video src={src} />,
}))

import { CaptionOverlay } from "../lib/caption-overlay"

const fixture: Caption[] = [
  { text: "Hello", startMs: 0, endMs: 500, timestampMs: 0, confidence: null },
  { text: " world", startMs: 500, endMs: 1000, timestampMs: 500, confidence: null },
]

describe("CaptionOverlay", () => {
  it.each(["subtitle", "word-highlight", "karaoke", "tiktok-words", "word-pop", "bouncy"] as const)(
    "renders style %s without throwing",
    (style) => {
      const html = renderToStaticMarkup(
        <CaptionOverlay
          captions={fixture}
          style={style}
          position="bottom"
          fontSize={32}
          color="#ffffff"
        />,
      )
      expect(html.length).toBeGreaterThan(0)
    },
  )
})

import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("remotion", () => ({
  useCurrentFrame: () => 40,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 240 }),
  interpolate: (v: number, [a, b]: number[], [c, d]: number[]) => (v <= a ? c : v >= b ? d : c + ((v - a) / (b - a)) * (d - c)),
  Easing: { ease: (t: number) => t, out: (fn: (t: number) => number) => fn },
  AbsoluteFill: ({ children, style }: { children: unknown; style?: unknown }) => <div style={style as object}>{children as never}</div>,
  Img: (p: { src: string; style?: object }) => <img src={p.src} style={p.style} />,
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: {},
  SUPPORTED_FONTS: [],
  // withRtlFallback is required — DeviceSurfaceShowcase calls blueprintFontFamily(brand)
  // (transitively resolveFontStack → withRtlFallback), matching the precedent in
  // logo-assemble-lockup.test.ts (the other blueprint test that renders via renderToStaticMarkup).
  withRtlFallback: (fontFamily: string) => fontFamily,
}))

import { DeviceSurfaceShowcase } from "../device-surface-showcase"

const brand = { backgroundColor: "#000", palette: { text: "#fff", accent: "#8b5cf6" } } as never

describe("DeviceSurfaceShowcase", () => {
  it("renders the device + screen images", () => {
    const html = renderToStaticMarkup(
      <DeviceSurfaceShowcase params={{ deviceImage: "https://cdn/d.png", screens: ["https://cdn/a.png", "https://cdn/b.png"] }} durationInFrames={240} brand={brand} />,
    )
    expect(html).toContain("https://cdn/d.png")
    expect(html).toContain("https://cdn/a.png")
  })
})

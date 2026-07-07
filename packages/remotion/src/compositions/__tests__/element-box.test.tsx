import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
  interpolate: (v: number, [a, b]: number[], [c, d]: number[]) => (v <= a ? c : v >= b ? d : c + ((v - a) / (b - a)) * (d - c)),
  // shot-sequence-renderer.tsx transitively imports lib/mg-motion.ts, whose
  // module-scope EASING_MAP calls Easing.linear/.inOut(...)/.bezier(...) at
  // import time (unlike logo-assemble-lockup.tsx / registry.ts's blueprints,
  // which never import mg-motion) — the mock needs the full Easing surface
  // or the import itself throws before any test body runs.
  Easing: {
    linear: (t: number) => t,
    ease: (t: number) => t,
    out: (fn: (t: number) => number) => fn,
    inOut: (fn: (t: number) => number) => fn,
    bezier: () => (t: number) => t,
  },
  Img: (p: { src: string; style?: Record<string, unknown> }) => <img src={p.src} style={p.style} />,
  Sequence: ({ children }: { children: unknown }) => children,
  AbsoluteFill: ({ children }: { children: unknown }) => children,
}))

import { ElementBox } from "../shot-sequence-renderer"

describe("ElementBox", () => {
  it("renders a text element (existing branch unchanged)", () => {
    const html = renderToStaticMarkup(
      <ElementBox element={{ id: "t", type: "text", text: "Hi", fontSize: 40, x: 0, y: 0 }} style={{}} />,
    )
    expect(html).toContain("Hi")
  })
  it("renders a shape element (existing branch unchanged)", () => {
    const html = renderToStaticMarkup(
      <ElementBox element={{ id: "s", type: "shape", shape: "circle", x: 0, y: 0, width: 20, height: 20 }} style={{}} />,
    )
    expect(html).toContain("<circle")
  })
  it("renders an image element as an <img> with the guarded src", () => {
    const html = renderToStaticMarkup(
      <ElementBox element={{ id: "i", type: "image", src: "https://cdn/x.png", x: 0, y: 0, width: 100, height: 60 }} style={{}} />,
    )
    expect(html).toContain("https://cdn/x.png")
  })
})

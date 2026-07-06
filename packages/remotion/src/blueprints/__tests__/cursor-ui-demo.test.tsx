import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
vi.mock("remotion", () => ({
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 210 }),
  interpolate: (v: number, [a, b]: number[], [c, d]: number[]) => (v <= a ? c : v >= b ? d : c + ((v - a) / (b - a)) * (d - c)),
  Easing: { ease: (t: number) => t, out: (fn: (t: number) => number) => fn },
  AbsoluteFill: ({ children, style }: { children: unknown; style?: unknown }) => <div style={style as object}>{children as never}</div>,
  Img: (p: { src: string; style?: object }) => <img src={p.src} style={p.style} />,
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: {},
  SUPPORTED_FONTS: [],
  // withRtlFallback is required — CursorUiDemo calls blueprintFontFamily(brand)
  // (transitively resolveFontStack → withRtlFallback), matching the precedent in
  // device-surface-showcase.test.tsx / logo-assemble-lockup.test.ts (the other
  // blueprint tests that render via renderToStaticMarkup).
  withRtlFallback: (fontFamily: string) => fontFamily,
}))
import { CursorUiDemo } from "../cursor-ui-demo"
const brand = { backgroundColor: "#0b0b0f", palette: { text: "#fff", accent: "#22d3ee" } } as never

describe("CursorUiDemo", () => {
  it("renders the UI screen and the cursor polygon", () => {
    const html = renderToStaticMarkup(
      <CursorUiDemo params={{ screens: ["https://cdn/a.png", "https://cdn/b.png"], targets: [{ xPct: 30, yPct: 40 }, { xPct: 70, yPct: 60 }] }} durationInFrames={210} brand={brand} />,
    )
    expect(html).toContain("https://cdn/a.png")
    expect(html).toContain("<polygon")
  })

  it("renders the per-beat caption label with brand font + direction styling when labels are provided", () => {
    // frame is mocked to 30 (useCurrentFrame above); durationInFrames=210 with
    // 2 targets → segLen=105 → beat=floor(30/105)=0 → labels[0] is the active caption.
    const html = renderToStaticMarkup(
      <CursorUiDemo
        params={{
          screens: ["https://cdn/a.png", "https://cdn/b.png"],
          targets: [{ xPct: 30, yPct: 40 }, { xPct: 70, yPct: 60 }],
          labels: ["Search anything", "Open the result"],
        }}
        durationInFrames={210}
        brand={brand}
      />,
    )
    expect(html).toContain("Search anything")
    // Caption div spreads directionStyle(text) + the brand fontFamily onto its
    // style — the RTL/brand-font surface the guard tests (brand-fill.test.ts,
    // blueprint-rtl.test.ts) require the source to wire up. No prior runtime
    // test exercised this branch because `labels` was never demonstrated.
    expect(html).toContain("direction:ltr")
    expect(html).toContain("font-family:Montserrat")
  })
})

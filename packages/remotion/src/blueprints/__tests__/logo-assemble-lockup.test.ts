import { describe, it, expect, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("remotion", () => ({
  useCurrentFrame: () => 40,
  useVideoConfig: () => ({ width: 1920, height: 1080 }),
  interpolate: (f: number, _i: number[], o: number[]) => o[o.length - 1],
  Easing: { out: (fn: unknown) => fn, ease: (x: number) => x },
  Img: (props: Record<string, unknown>) => {
    const { onError: _o, ...rest } = props
    return React.createElement("img", rest)
  },
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: { Montserrat: "Montserrat, sans-serif" },
  SUPPORTED_FONTS: ["Montserrat"],
  withRtlFallback: (fontFamily: string) => fontFamily,
}))

import { letterEntranceProgress, logoRowDirection, LogoAssembleLockup, chooseLogoRender } from "../logo-assemble-lockup"

// Reference constants matching the component:
//   LETTER_ENTRANCE_FRAMES = 12
//   STAGGER_WINDOW_FRACTION = 0.5
//
// With count=4, durationFrames=60:
//   staggerWindow = round(60 * 0.5) = 30
//   staggerPerLetter = floor(30 / 3) = 10
//   letterStart(i) = i * 10
//   lastLetterEnd = 3*10 + 12 = 42

describe("letterEntranceProgress", () => {
  it("returns 0 at frame 0 for letter 0 (localFrame=0)", () => {
    expect(letterEntranceProgress(0, 0, 4, 60)).toBe(0)
  })

  it("returns 1 once letter 0 completes its entrance (frame >= 12)", () => {
    expect(letterEntranceProgress(12, 0, 4, 60)).toBe(1)
    expect(letterEntranceProgress(30, 0, 4, 60)).toBe(1)
  })

  it("returns 0 for letter 1 before its start frame (frame < 10)", () => {
    expect(letterEntranceProgress(0, 1, 4, 60)).toBe(0)
    expect(letterEntranceProgress(9, 1, 4, 60)).toBe(0)
  })

  it("returns 0 for letter 1 at exactly its start frame (localFrame=0 → progress 0)", () => {
    // letterStart(1) = 10 → localFrame = 10-10 = 0 → 0
    expect(letterEntranceProgress(10, 1, 4, 60)).toBe(0)
  })

  it("returns 1 once letter 1 completes its entrance (frame >= 10+12=22)", () => {
    expect(letterEntranceProgress(22, 1, 4, 60)).toBe(1)
    expect(letterEntranceProgress(40, 1, 4, 60)).toBe(1)
  })

  it("returns 0 for letter 3 at frame 0 (hasn't started)", () => {
    // letterStart(3) = 30 > 0
    expect(letterEntranceProgress(0, 3, 4, 60)).toBe(0)
  })

  it("returns 1 for the last letter (index 3) once it has completed (frame >= 30+12=42)", () => {
    expect(letterEntranceProgress(42, 3, 4, 60)).toBe(1)
    expect(letterEntranceProgress(60, 3, 4, 60)).toBe(1)
  })

  it("returns eased intermediate at mid-entrance for letter 0 (frame=6)", () => {
    // localFrame=6, t=0.5 → ease-out = 1 - (0.5)² = 0.75
    expect(letterEntranceProgress(6, 0, 4, 60)).toBeCloseTo(0.75, 5)
  })

  it("returns eased intermediate at mid-entrance for letter 2 (frame=20+6=26)", () => {
    // letterStart(2) = 20, mid-entrance = 20+6 = 26, t=0.5 → 0.75
    expect(letterEntranceProgress(26, 2, 4, 60)).toBeCloseTo(0.75, 5)
  })

  it("handles count=1 (single letter starts immediately at frame 0)", () => {
    // staggerPerLetter=0 when count=1 → letterStart=0 for index 0
    expect(letterEntranceProgress(0, 0, 1, 60)).toBe(0)
    expect(letterEntranceProgress(12, 0, 1, 60)).toBe(1)
    expect(letterEntranceProgress(6, 0, 1, 60)).toBeCloseTo(0.75, 5)
  })

  it("is monotonically increasing over the entrance window for each letter", () => {
    for (const index of [0, 1, 2, 3]) {
      const start = index * 10
      const frames = [start, start + 3, start + 6, start + 9, start + 12, start + 15]
      const values = frames.map((f) => letterEntranceProgress(f, index, 4, 60))
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1])
      }
    }
  })

  it("never exceeds 1", () => {
    for (const frame of [0, 5, 10, 15, 20, 30, 42, 60]) {
      for (const index of [0, 1, 2, 3]) {
        expect(letterEntranceProgress(frame, index, 4, 60)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe("logoRowDirection", () => {
  it("returns ltr for a Latin brand name (Latin output stays byte-identical)", () => {
    expect(logoRowDirection("Acme")).toBe("ltr")
  })

  it("returns rtl for a Hebrew brand name", () => {
    expect(logoRowDirection("שלום")).toBe("rtl")
  })

  it("returns rtl for an Arabic brand name", () => {
    expect(logoRowDirection("مرحبا")).toBe("rtl")
  })

  it("falls back to ltr when there is no strong directional character", () => {
    expect(logoRowDirection("123")).toBe("ltr")
    expect(logoRowDirection("")).toBe("ltr")
  })
})

const brandBase = {
  backgroundColor: "#000",
  palette: { bg: "#000", text: "#fff", accent: "#f5a" },
  fonts: { heading: "Anton", body: "Inter" },
}

describe("chooseLogoRender", () => {
  it("image when a URL is present and no error", () =>
    expect(chooseLogoRender("https://cdn/x.png", false)).toBe("image"))
  it("cascade when the image errored", () =>
    expect(chooseLogoRender("https://cdn/x.png", true)).toBe("cascade"))
  it("cascade when no image", () => expect(chooseLogoRender(undefined, false)).toBe("cascade"))
})

describe("LogoAssembleLockup render", () => {
  const render = (brand: object) =>
    renderToStaticMarkup(
      React.createElement(LogoAssembleLockup, {
        params: { brand: "NODARO" },
        durationInFrames: 180,
        brand,
      } as never),
    )
  it("renders an <img> when brand.logo.image is set", () => {
    const html = render({ ...brandBase, logo: { name: "NODARO", image: "https://cdn/logo.png" } })
    expect(html).toContain("<img")
    expect(html).toContain("https://cdn/logo.png")
    expect(html).not.toContain(">N<") // cascade must be suppressed when the image branch renders
  })
  it("renders the letter-cascade (no <img>) when no logo image — byte-identical path", () => {
    const html = render({ ...brandBase, logo: { name: "NODARO" } })
    expect(html).not.toContain("<img")
    expect(html).toContain(">N<") // first cascade letter span
  })
})

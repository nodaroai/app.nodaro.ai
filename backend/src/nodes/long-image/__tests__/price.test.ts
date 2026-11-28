import { describe, it, expect } from "vitest"
import { longImageCreditIds } from "@nodaro/render-rules"
import { LONG_IMAGE_INPUT_IMAGE_KIE_HUNDREDTHS, LONG_IMAGE_KIE_HUNDREDTHS } from "../../../providers/kie/models.js"
import { price } from "../price.ee.js"

/**
 * Long Image's rows (decided 2026-11-22): one per webpage size and picture
 * count (0 to 2), and per product-page length, size and picture count (1 to
 * 3). Each row is the base of its run's provider figure, the pictures
 * included, rounded up once — from the same figures the job's provider cost
 * records (providers/kie/models.ts).
 */
const base = (hundredths: number, pictures: number) => Math.ceil(((hundredths + LONG_IMAGE_INPUT_IMAGE_KIE_HUNDREDTHS * pictures) * 25) / 1000)
const row = (id: string) => price.staticCosts[id as keyof typeof price.staticCosts]

describe("long-image price", () => {
  it("every reachable run has a row, each the formula, plus the bare row at the default run", () => {
    const ids = longImageCreditIds("long-image")
    expect(ids).toHaveLength(24)
    expect(Object.keys(price.staticCosts).sort()).toEqual(["long-image", ...ids].sort())
    for (const size of ["1K", "2K"] as const) {
      for (let n = 0; n <= 2; n++) {
        expect(row(`long-image:webpage:${size}${n ? `:${n}ref` : ""}`), `webpage ${size} ${n}`).toBe(base(LONG_IMAGE_KIE_HUNDREDTHS.webpage[size], n))
      }
      for (const length of ["short", "medium", "long"] as const) {
        for (let n = 1; n <= 3; n++) {
          expect(row(`long-image:ecommerce:${length}:${size}:${n}ref`), `${length} ${size} ${n}`).toBe(base(LONG_IMAGE_KIE_HUNDREDTHS.ecommerce[length][size], n))
        }
      }
    }
    expect(row("long-image")).toBe(row("long-image:webpage:2K"))
  })

  it("the decided rows without pictures, and the docs' worked examples", () => {
    expect([row("long-image:webpage:1K"), row("long-image:webpage:2K")]).toEqual([248, 269])
    // A product page always sends at least one picture: its rows start at one.
    expect([row("long-image:ecommerce:short:1K:1ref"), row("long-image:ecommerce:short:2K:1ref")]).toEqual([108, 129])
    expect([row("long-image:ecommerce:medium:1K:1ref"), row("long-image:ecommerce:medium:2K:1ref")]).toEqual([213, 249])
    expect([row("long-image:ecommerce:long:1K:1ref"), row("long-image:ecommerce:long:2K:1ref")]).toEqual([354, 389])
    expect(row("long-image:webpage:2K:1ref")).toBe(270)
    expect(row("long-image:webpage:2K:2ref")).toBe(272)
    expect(row("long-image:ecommerce:medium:2K:3ref")).toBe(252)
    expect(row("long-image:ecommerce:long:1K:2ref")).toBe(355)
  })

  it("an estimate from the node's data prices the most pictures its mode can send; a job's request, the ones it sends", () => {
    const id = price.creditId!
    expect(id({})).toBe("long-image:webpage:2K:2ref")
    expect(id({ mode: "webpage", resolution: "1K" })).toBe("long-image:webpage:1K:2ref")
    expect(id({ mode: "ecommerce", length: "short", resolution: "1K" })).toBe("long-image:ecommerce:short:1K:3ref")
    expect(id({ mode: "ecommerce" })).toBe("long-image:ecommerce:medium:2K:3ref")
    // A job's input_data states the pictures it sends.
    expect(id({ mode: "webpage", resolution: "2K", inputImages: 0 })).toBe("long-image:webpage:2K")
    expect(id({ mode: "ecommerce", length: "long", resolution: "2K", inputImages: 2 })).toBe("long-image:ecommerce:long:2K:2ref")
    // Junk settles to the defaults and the mode's bounds.
    expect(id({ mode: "poster", resolution: "8K", length: "huge" })).toBe("long-image:webpage:2K:2ref")
    expect(id({ mode: "ecommerce", inputImages: 0 })).toBe("long-image:ecommerce:medium:2K:1ref")
    expect(id({ mode: "webpage", inputImages: 9 })).toBe("long-image:webpage:2K:2ref")
  })
})

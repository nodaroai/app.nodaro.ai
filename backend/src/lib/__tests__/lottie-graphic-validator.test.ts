import { describe, it, expect } from "vitest"
import { validateLottieGraphic, LOTTIE_FONT_SAFELIST } from "../lottie-graphic-validator.js"
import { MOTION_GRAPHICS_SYSTEM_PROMPT } from "../../prompts/motion-graphics-system.js"
import { validatePlanByType } from "../plan-schemas.js"

const EXPECTED = { fps: 30, width: 1920, height: 1080, durationInFrames: 150, backgroundColor: "#00000000" }
const base = (over: Record<string, unknown> = {}) => ({
  v: "5.7.0", fr: 30, ip: 0, op: 150, w: 1920, h: 1080, layers: [], ...over,
})

describe("rule 1: envelope fr/ip/op/w/h match the request", () => {
  it("auto-fixes mismatched fr/op/w/h", () => {
    const r = validateLottieGraphic(base({ fr: 60, op: 300, w: 100, h: 100 }), EXPECTED)
    const lottie = (r.plan!.lottie as Record<string, unknown>)
    expect(lottie.fr).toBe(30); expect(lottie.op).toBe(150)
    expect(lottie.w).toBe(1920); expect(lottie.h).toBe(1080)
    expect(r.autoFixed.length).toBeGreaterThan(0)
  })
})

describe("rule 2: layer ip/op clamped to [0, op]", () => {
  it("clamps out-of-range layer in/out points", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: -10, op: 9999, shapes: [] }] }), EXPECTED)
    const layer = (r.plan!.lottie as any).layers[0]
    expect(layer.ip).toBe(0); expect(layer.op).toBe(150)
  })
})

describe("rule 3: every shape primitive wrapped in a group ending in tr", () => {
  it("auto-wraps bare primitives and appends a default transform", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "rc" }, { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] } }] }] }), EXPECTED)
    const shapes = (r.plan!.lottie as any).layers[0].shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].ty).toBe("gr")
    const it = shapes[0].it
    expect(it[it.length - 1].ty).toBe("tr")
  })
  it("appends tr to an existing group missing one", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "el" }] }] }] }), EXPECTED)
    const it = (r.plan!.lottie as any).layers[0].shapes[0].it
    expect(it[it.length - 1].ty).toBe("tr")
  })
})

describe("rule 11: repeater integrity", () => {
  // Shape of prod job 73e2c691 (2026-06-11): repeater FIRST in the group and
  // missing its `tr` entirely — lottie-web threw on `data.tr.so`, DOMLoaded
  // never fired, and the render hung to the 118s delayRender timeout.
  const brokenRepeaterGroup = () => ({
    ty: "gr",
    it: [
      { c: { a: 0, k: 30 }, m: 1, o: { a: 0, k: 100 }, ty: "rp" },
      { d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [15, 8] }, ty: "rc" },
      { c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, ty: "fl" },
      { a: { a: 0, k: [0, 0] }, o: { a: 0, k: 100 }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100] }, ty: "tr" },
    ],
  })

  it("completes a repeater missing its tr (so/eo) and repositions it after the shapes", () => {
    const r = validateLottieGraphic(
      base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [brokenRepeaterGroup()] }] }),
      EXPECTED,
    )
    expect(r.rejected).toBe(false)
    const it = (r.plan!.lottie as any).layers[0].shapes[0].it
    // Order healed: [rc, fl, rp, tr] — repeater after the drawables, before the group tr.
    expect(it.map((s: any) => s.ty)).toEqual(["rc", "fl", "rp", "tr"])
    const rp = it[2]
    expect(rp.tr).toBeDefined()
    expect(rp.tr.so).toEqual({ a: 0, k: 100 })
    expect(rp.tr.eo).toEqual({ a: 0, k: 100 })
    expect(rp.tr.p).toEqual({ a: 0, k: [0, 0] })
    expect(rp.c).toEqual({ a: 0, k: 30 }) // existing copies count untouched
    expect(r.autoFixed.some((m) => m.includes("repeater"))).toBe(true)
  })

  it("fills only missing tr fields, preserving authored per-copy offsets", () => {
    const group = brokenRepeaterGroup()
    ;(group.it[0] as any).tr = { p: { a: 0, k: [12, -4] }, r: { a: 0, k: 15 } }
    const r = validateLottieGraphic(
      base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [group] }] }),
      EXPECTED,
    )
    const rp = (r.plan!.lottie as any).layers[0].shapes[0].it[2]
    expect(rp.tr.p).toEqual({ a: 0, k: [12, -4] })
    expect(rp.tr.r).toEqual({ a: 0, k: 15 })
    expect(rp.tr.so).toEqual({ a: 0, k: 100 })
  })

  it("leaves a complete, correctly placed repeater untouched", () => {
    const goodGroup = {
      ty: "gr",
      it: [
        { d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [15, 8] }, ty: "rc" },
        { c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, ty: "fl" },
        {
          ty: "rp", c: { a: 0, k: 12 }, o: { a: 0, k: 0 }, m: 1,
          tr: { a: { a: 0, k: [0, 0] }, p: { a: 0, k: [20, -10] }, r: { a: 0, k: 30 }, s: { a: 0, k: [98, 98] }, so: { a: 0, k: 100 }, eo: { a: 0, k: 100 } },
        },
        { a: { a: 0, k: [0, 0] }, o: { a: 0, k: 100 }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100] }, ty: "tr" },
      ],
    }
    const r = validateLottieGraphic(
      base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [goodGroup] }] }),
      EXPECTED,
    )
    expect(r.autoFixed.filter((m) => m.toLowerCase().includes("repeater"))).toEqual([])
    const it = (r.plan!.lottie as any).layers[0].shapes[0].it
    expect(it.map((s: any) => s.ty)).toEqual(["rc", "fl", "rp", "tr"])
  })

  it("moves a layer-level leading repeater after the groups it should duplicate", () => {
    const r = validateLottieGraphic(
      base({
        layers: [{
          ty: 4, ip: 0, op: 150,
          shapes: [
            { c: { a: 0, k: 5 }, ty: "rp" },
            { ty: "gr", it: [{ ty: "el" }, { ty: "tr" }] },
          ],
        }],
      }),
      EXPECTED,
    )
    const shapes = (r.plan!.lottie as any).layers[0].shapes
    expect(shapes.map((s: any) => s.ty)).toEqual(["gr", "rp"])
    const rp = shapes[1]
    expect(rp.tr.so).toEqual({ a: 0, k: 100 })
    expect(rp.o).toEqual({ a: 0, k: 0 })
    expect(rp.m).toBe(1)
  })
})

describe("rule 4: colors normalized to 0-1", () => {
  it("divides 0-255 components by 255", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 0, k: [255, 128, 0, 1] } }, { ty: "tr" }] }] }] }), EXPECTED)
    const k = (r.plan!.lottie as any).layers[0].shapes[0].it[0].c.k
    expect(k[0]).toBeCloseTo(1); expect(k[1]).toBeCloseTo(0.5, 1); expect(k[2]).toBe(0)
  })
  it("preserves already-normalized alpha when scaling 0-255 RGB", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 0, k: [255, 128, 0, 1] } }, { ty: "tr" }] }] }] }), EXPECTED)
    const k = (r.plan!.lottie as any).layers[0].shapes[0].it[0].c.k
    expect(k[0]).toBeCloseTo(1); expect(k[1]).toBeCloseTo(0.502, 2); expect(k[2]).toBe(0)
    expect(k[3]).toBe(1)
  })
  it("scales alpha only when alpha itself exceeds 1", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 0, k: [255, 128, 0, 255] } }, { ty: "tr" }] }] }] }), EXPECTED)
    const k = (r.plan!.lottie as any).layers[0].shapes[0].it[0].c.k
    expect(k[3]).toBe(1)
  })
  it("logs one line per keyframed color property", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 1, k: [{ t: 0, s: [255, 0, 0], e: [0, 255, 0] }, { t: 30, s: [0, 255, 0] }] } }, { ty: "tr" }] }] }] }), EXPECTED)
    const lines = r.autoFixed.filter((l) => /keyframed color/i.test(l))
    expect(lines).toHaveLength(1)
  })
})

describe("rule 5: keyframe scalar values wrapped as arrays", () => {
  it("wraps bare-number keyframe s values", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, ks: { o: { a: 1, k: [{ t: 0, s: 0 }, { t: 30, s: 100 }] } }, shapes: [] }] }), EXPECTED)
    const kf = (r.plan!.lottie as any).layers[0].ks.o.k
    expect(kf[0].s).toEqual([0]); expect(kf[1].s).toEqual([100])
  })
})

describe("rule 6: sid referenced but missing from slots auto-added", () => {
  it("adds a slot from the inline value", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 0, k: [1, 0, 0, 1], sid: "primaryColor" } }, { ty: "tr" }] }] }] }), EXPECTED)
    const slots = r.plan!.slots as Record<string, any>
    expect(slots.primaryColor?.p).toEqual({ a: 0, k: [1, 0, 0, 1] })
  })
})

describe("rule 7: expressions stripped, split-position objects preserved", () => {
  it("removes string-valued x everywhere and logs it", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, ks: { p: { a: 0, k: [0, 0], x: "var $bm_rt = wiggle(5,50);" } }, shapes: [] }] }), EXPECTED)
    expect((r.plan!.lottie as any).layers[0].ks.p.x).toBeUndefined()
    expect(r.autoFixed.join(" ")).toMatch(/expression/i)
  })
  it("preserves object-valued x (split position)", () => {
    const split = { s: true, x: { a: 0, k: 100 }, y: { a: 0, k: 200 } }
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, ks: { p: split }, shapes: [] }] }), EXPECTED)
    expect((r.plan!.lottie as any).layers[0].ks.p.x).toEqual({ a: 0, k: 100 })
  })
  it("strips string x inside root slot values", () => {
    const r = validateLottieGraphic(
      base({
        layers: [{ ty: 4, ip: 0, op: 150, ks: { p: { sid: "evilPos" } }, shapes: [] }],
        slots: { evilPos: { p: { a: 0, k: [0, 0], x: "var $bm_rt = wiggle(9,99);" } } },
      }),
      EXPECTED,
    )
    expect((r.plan!.slots as any).evilPos.p.x).toBeUndefined()
    expect(r.autoFixed.join(" ")).toMatch(/expression/i)
  })
  it("strips string x from slots auto-added by rule 6", () => {
    const r = validateLottieGraphic(
      base({
        layers: [
          {
            ty: 4,
            ip: 0,
            op: 150,
            shapes: [{ ty: "gr", it: [{ ty: "fl", c: { a: 0, k: [1, 0, 0, 1], x: "evil()", sid: "primaryColor" } }, { ty: "tr" }] }],
          },
        ],
      }),
      EXPECTED,
    )
    expect((r.plan!.slots as any).primaryColor.p.x).toBeUndefined()
  })
})

describe("rule 8: image assets rejected (vector-only v1)", () => {
  it("rejects image asset entries, allows precomps", () => {
    const img = validateLottieGraphic(base({ assets: [{ id: "image_0", w: 100, h: 100, u: "https://evil.example/", p: "img.png" }] }), EXPECTED)
    expect(img.rejected).toBe(true)
    const precomp = validateLottieGraphic(base({ assets: [{ id: "comp_0", layers: [] }] }), EXPECTED)
    expect(precomp.rejected).toBe(false)
  })
})

describe("rule 9: size caps", () => {
  it("rejects > 50 layers", () => {
    const layers = Array.from({ length: 51 }, (_, i) => ({ ty: 4, ip: 0, op: 150, nm: `l${i}`, shapes: [] }))
    const r = validateLottieGraphic(base({ layers }), EXPECTED)
    expect(r.rejected).toBe(true)
    expect(r.errors.join(" ")).toMatch(/50/)
  })
  it("rejects > 128 KB serialized", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, nm: "x".repeat(140_000), shapes: [] }] }), EXPECTED)
    expect(r.rejected).toBe(true)
  })
})

describe("rule 10: fonts — external refs stripped, families snapped to safelist", () => {
  it("strips fPath/fOrigin and snaps unknown families to Inter", () => {
    const r = validateLottieGraphic(base({ fonts: { list: [{ fFamily: "Comic Sans MS", fName: "Comic", fPath: "https://evil.example/font.woff2", fOrigin: 3 }] } }), EXPECTED)
    const font = (r.plan!.lottie as any).fonts.list[0]
    expect(font.fPath).toBeUndefined(); expect(font.fOrigin).toBeUndefined()
    expect(font.fFamily).toBe("Inter")
  })
  it("safelist families pass through and match the elements prompt", () => {
    for (const family of LOTTIE_FONT_SAFELIST) {
      expect(MOTION_GRAPHICS_SYSTEM_PROMPT).toContain(family)
    }
  })
})

describe("plan assembly", () => {
  it("root slots are extracted to plan.slots and removed from plan.lottie", () => {
    const r = validateLottieGraphic(base({ slots: { primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } } }), EXPECTED)
    expect((r.plan!.lottie as any).slots).toBeUndefined()
    expect((r.plan!.slots as any).primaryColor).toBeDefined()
  })
  it("rejects non-object documents and documents without layers[]", () => {
    expect(validateLottieGraphic("nope", EXPECTED).rejected).toBe(true)
    expect(validateLottieGraphic({ v: "5.7.0" }, EXPECTED).rejected).toBe(true)
  })
})

describe("validator output round-trips through validatePlanByType", () => {
  it("accepts the assembled plan verbatim", () => {
    const r = validateLottieGraphic(base({ layers: [{ ty: 4, ip: 0, op: 150, shapes: [] }] }), EXPECTED)
    expect(r.rejected).toBe(false)
    expect(() => validatePlanByType("lottie-graphic", r.plan!)).not.toThrow()
  })
})

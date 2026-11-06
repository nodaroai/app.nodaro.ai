import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
  engineRoutesPreciseStyle,
  nodaroMotionPreciseStyleRouteSchema,
  parseNodaroMotionPreciseStyleRoute,
  preciseStyleRouteForPlugin,
  withoutDefaultPreciseStyleRoute,
} from "../nodaro-motion-precise-style-route.js"
import { NODARO_MOTION_PRECISE_ART_STYLE_KEY } from "../nodaro-motion-precise-art-style.js"

// The Precise art-style route's setting (pure): `{ routing?: "off"; bypassEmails?: string[] }`, its own row, the defaults
// (on, nobody bypassed) stored as nothing, read tolerantly so that a row saved by newer code still reads here.
describe("nodaro-motion-precise-style-route", () => {
  it("is a row of its own", () => {
    expect(NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY).toBe("nodaro_motion_precise_style_route")
    expect(NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY).not.toBe(NODARO_MOTION_PRECISE_ART_STYLE_KEY)
  })

  it("leaves the defaults out: only Off and a list that is not empty are kept, new objects", () => {
    expect(withoutDefaultPreciseStyleRoute(null)).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({})).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ routing: "on", bypassEmails: [] })).toEqual({})
    const given = { routing: "off" as const, bypassEmails: ["a@example.com"] }
    const kept = withoutDefaultPreciseStyleRoute(given)
    expect(kept).toEqual(given)
    expect(kept.bypassEmails).not.toBe(given.bypassEmails)
  })

  describe("what an admin saves", () => {
    const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

    it("takes the switch and the list, the emails trimmed, lowercased and without repeats", () => {
      expect(parse({}).success).toBe(true)
      expect(parse({ routing: "off" }).data).toEqual({ routing: "off" })
      expect(parse({ routing: "on", bypassEmails: [" Tester@Example.COM ", "tester@example.com", "b@example.com"] }).data).toEqual({
        routing: "on",
        bypassEmails: ["tester@example.com", "b@example.com"],
      })
    })

    it("is strict: an unknown key, a third value or something that is not an email is refused", () => {
      expect(parse({ routing: "sideways" }).success).toBe(false)
      expect(parse({ route: "off" }).success).toBe(false)
      expect(parse({ bypassEmails: ["not an email"] }).success).toBe(false)
      expect(parse({ bypassEmails: "a@example.com" }).success).toBe(false)
      expect(parse({ bypassEmails: [7] }).success).toBe(false)
    })

    it("caps the list", () => {
      const many = Array.from({ length: 201 }, (_, i) => `t${i}@example.com`)
      expect(parse({ bypassEmails: many }).success).toBe(false)
      expect(parse({ bypassEmails: many.slice(0, 200) }).success).toBe(true)
    })
  })

  it("answers the engine what differs, a copy; null when nothing does", () => {
    expect(preciseStyleRouteForPlugin(null)).toBeNull()
    expect(preciseStyleRouteForPlugin({ routing: "on", bypassEmails: [] })).toBeNull()
    const saved = { bypassEmails: ["a@example.com"] }
    const answer = preciseStyleRouteForPlugin(saved)
    expect(answer).toEqual({ bypassEmails: ["a@example.com"] })
    expect(answer!.bypassEmails).not.toBe(saved.bypassEmails)
    expect(preciseStyleRouteForPlugin({ routing: "off" })).toEqual({ routing: "off" })
  })

  describe("the tolerant read of the stored row", () => {
    it("reads what is saved", () => {
      const warn = vi.fn()
      expect(parseNodaroMotionPreciseStyleRoute({}, warn)).toEqual({})
      expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", bypassEmails: ["a@example.com"] }, warn)).toEqual({ routing: "off", bypassEmails: ["a@example.com"] })
      expect(warn).not.toHaveBeenCalled()
    })

    it("a row saved by newer code still reads: an unknown key drops nothing, and is not kept", () => {
      const warn = vi.fn()
      const row = { routing: "off", bypassEmails: ["a@example.com"], somethingNewer: { x: 1 } }
      expect(parseNodaroMotionPreciseStyleRoute(row, warn)).toEqual({ routing: "off", bypassEmails: ["a@example.com"] })
      expect(warn).not.toHaveBeenCalled()
    })

    it("each field on its own: a bad switch reads as on, a bad list as empty, a bad email is dropped alone, each with a warning naming no email", () => {
      const warn = vi.fn()
      expect(parseNodaroMotionPreciseStyleRoute({ routing: "sideways", bypassEmails: ["a@example.com"] }, warn)).toEqual({ bypassEmails: ["a@example.com"] })
      expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", bypassEmails: "a@example.com" }, warn)).toEqual({ routing: "off" })
      expect(parseNodaroMotionPreciseStyleRoute({ bypassEmails: [" A@Example.com ", "nope", 7] }, warn)).toEqual({ bypassEmails: ["a@example.com"] })
      expect(warn).toHaveBeenCalledTimes(3)
      expect(warn.mock.calls.flat().join(" ")).not.toContain("a@example.com")
    })

    it("not an object reads as never saved (null)", () => {
      const warn = vi.fn()
      expect(parseNodaroMotionPreciseStyleRoute(null, warn)).toBeNull()
      expect(parseNodaroMotionPreciseStyleRoute("off", warn)).toBeNull()
      expect(parseNodaroMotionPreciseStyleRoute(["off"], warn)).toBeNull()
    })
  })

  it("an engine routes only when it declares castSwap.preciseStyleRoute", () => {
    expect(engineRoutesPreciseStyle(undefined)).toBe(false)
    expect(engineRoutesPreciseStyle({})).toBe(false)
    expect(engineRoutesPreciseStyle({ preciseStyleRoute: false })).toBe(false)
    expect(engineRoutesPreciseStyle({ preciseStyleRoute: true })).toBe(true)
  })
})

// A routed run's own depth blur (`routedDepthBlur`, 0–40 whole steps, the Motion masking's bounds): absent or 0 is none,
// stored only when above 0.
describe("nodaro-motion-precise-style-route: routedDepthBlur", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves a whole number from 0 to 40, and leaves 0 out", () => {
    expect(parse({ routedDepthBlur: 10 }).data).toEqual({ routedDepthBlur: 10 })
    expect(parse({ routedDepthBlur: 40 }).success).toBe(true)
    expect(withoutDefaultPreciseStyleRoute({ routedDepthBlur: 0 })).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ routedDepthBlur: 10 })).toEqual({ routedDepthBlur: 10 })
    for (const bad of [41, -1, 2.5, "10", null]) expect(parse({ routedDepthBlur: bad }).success).toBe(false)
  })

  it("is answered to the engine when set, and makes the setting differ from the defaults", () => {
    expect(preciseStyleRouteForPlugin({ routedDepthBlur: 10 })).toEqual({ routedDepthBlur: 10 })
    expect(preciseStyleRouteForPlugin({ routedDepthBlur: 0 })).toBeNull()
  })

  it("reads tolerantly: a value out of bounds is dropped with a warning, the other fields kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", routedDepthBlur: 12 }, warn)).toEqual({ routing: "off", routedDepthBlur: 12 })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", routedDepthBlur: 99 }, warn)).toEqual({ routing: "off" })
    expect(parseNodaroMotionPreciseStyleRoute({ routedDepthBlur: "10" }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

// A routed run's shot list told the colours (`describeColours`): on when absent; stored only when off.
describe("nodaro-motion-precise-style-route: describeColours", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves a boolean, and leaves on (the default) out", () => {
    expect(parse({ describeColours: false }).data).toEqual({ describeColours: false })
    expect(withoutDefaultPreciseStyleRoute({ describeColours: true })).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ describeColours: false })).toEqual({ describeColours: false })
    for (const bad of ["no", 0, null]) expect(parse({ describeColours: bad }).success).toBe(false)
  })

  it("is answered to the engine when off; on is no difference", () => {
    expect(preciseStyleRouteForPlugin({ describeColours: false })).toEqual({ describeColours: false })
    expect(preciseStyleRouteForPlugin({ describeColours: true })).toBeNull()
  })

  it("reads tolerantly: a value that is not a boolean is dropped (on) with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ describeColours: false }, warn)).toEqual({ describeColours: false })
    expect(parseNodaroMotionPreciseStyleRoute({ describeColours: "off", routing: "off" }, warn)).toEqual({ routing: "off" })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// A routed run's face mesh (`faceMesh`): off when absent; stored only when on.
describe("nodaro-motion-precise-style-route: faceMesh", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves a boolean, and leaves off (the default) out", () => {
    expect(parse({ faceMesh: true }).data).toEqual({ faceMesh: true })
    expect(withoutDefaultPreciseStyleRoute({ faceMesh: false })).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ faceMesh: true })).toEqual({ faceMesh: true })
    for (const bad of ["on", 1, null]) expect(parse({ faceMesh: bad }).success).toBe(false)
  })

  it("is answered to the engine when on; off is no difference", () => {
    expect(preciseStyleRouteForPlugin({ faceMesh: true })).toEqual({ faceMesh: true })
    expect(preciseStyleRouteForPlugin({ faceMesh: false })).toBeNull()
  })

  it("reads tolerantly: a value that is not a boolean is dropped (off) with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ faceMesh: true }, warn)).toEqual({ faceMesh: true })
    expect(parseNodaroMotionPreciseStyleRoute({ faceMesh: "on", routing: "off" }, warn)).toEqual({ routing: "off" })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// A routed run's mesh parts and wording (2026-11-06): what the mesh draws (absent: the Flex masking's, today's) and how
// its line is worded (absent: Motion). Stored only when set; read tolerantly.
describe("nodaro-motion-precise-style-route: faceMeshParts and faceMeshWording", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves the four parts and the two wordings, Motion (the default) left out", () => {
    for (const faceMeshParts of ["full", "features", "mouth", "contours"]) expect(parse({ faceMeshParts }).data).toEqual({ faceMeshParts })
    expect(parse({ faceMeshWording: "shape" }).data).toEqual({ faceMeshWording: "shape" })
    expect(withoutDefaultPreciseStyleRoute({ faceMeshWording: "motion" })).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ faceMeshWording: "shape", faceMeshParts: "contours" })).toEqual({ faceMeshWording: "shape", faceMeshParts: "contours" })
    for (const bad of [{ faceMeshParts: "wire" }, { faceMeshWording: "loud" }, { faceMeshParts: 1 }]) expect(parse(bad).success).toBe(false)
  })

  it("is answered to the engine when set", () => {
    expect(preciseStyleRouteForPlugin({ faceMeshParts: "contours", faceMeshWording: "shape" })).toEqual({ faceMeshParts: "contours", faceMeshWording: "shape" })
    expect(preciseStyleRouteForPlugin({ faceMeshWording: "motion" })).toBeNull()
  })

  it("reads tolerantly: a value of neither kind is dropped with a warning, the other fields kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ faceMeshParts: "contours", faceMeshWording: "shape" }, warn)).toEqual({ faceMeshParts: "contours", faceMeshWording: "shape" })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", faceMeshParts: "wire", faceMeshWording: 3 }, warn)).toEqual({ routing: "off" })
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

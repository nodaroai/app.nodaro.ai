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

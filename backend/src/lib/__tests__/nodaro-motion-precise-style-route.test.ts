import { describe, expect, it, vi } from "vitest"
import { STYLES } from "@nodaro/prompts/pickers"
import {
  NODARO_MOTION_PRECISE_STYLE_ROUTE_KEY,
  STYLE_ROUTE_ID_PATTERN,
  engineRoutesPerStyle,
  engineRoutesPreciseStyle,
  nodaroMotionPreciseStyleRouteSchema,
  parseNodaroMotionPreciseStyleRoute,
  preciseStyleRouteForPlugin,
  withoutDefaultPreciseStyleRoute,
  type NodaroMotionPreciseStyleRoute,
} from "../nodaro-motion-precise-style-route.js"
import { filmedStyleIds, styleRoutesForEngine } from "../nodaro-motion-precise-style-route-engine.js"
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

describe("nodaro-motion-precise-style-route: faceMeshLayers", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves a set of layers; never beside parts, never a set that draws nothing, never an unknown layer", () => {
    expect(parse({ faceMesh: true, faceMeshLayers: { irises: true, bold: true } }).data).toEqual({ faceMesh: true, faceMeshLayers: { irises: true, bold: true } })
    for (const bad of [
      { faceMeshLayers: { eyes: true }, faceMeshParts: "full" },
      { faceMeshLayers: { bold: true } },
      { faceMeshLayers: {} },
      { faceMeshLayers: { nose: true } },
    ]) expect(parse(bad).success, JSON.stringify(bad)).toBe(false)
  })

  it("stores and answers a set a parts value names as that value (contours included); any other with only its layers on", () => {
    expect(withoutDefaultPreciseStyleRoute({ faceMeshLayers: { wireframe: true, eyes: true, lips: true } })).toEqual({ faceMeshParts: "full" })
    expect(withoutDefaultPreciseStyleRoute({ faceMeshLayers: { eyes: true, lips: true, contours: true, irises: false } })).toEqual({ faceMeshParts: "contours" })
    expect(withoutDefaultPreciseStyleRoute({ faceMeshLayers: { contours: true, irises: true, wireframe: false } })).toEqual({ faceMeshLayers: { contours: true, irises: true } })
    expect(withoutDefaultPreciseStyleRoute({ faceMeshLayers: { bold: true } })).toEqual({})
    expect(preciseStyleRouteForPlugin({ faceMesh: true, faceMeshLayers: { irises: true } })).toEqual({ faceMesh: true, faceMeshLayers: { irises: true } })
  })

  it("reads tolerantly: unknown layers ignored, a set that draws nothing dropped with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ faceMeshLayers: { irises: true, nose: true } }, warn)).toEqual({ faceMeshLayers: { irises: true } })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreciseStyleRoute({ routing: "off", faceMeshLayers: { bold: true } }, warn)).toEqual({ routing: "off" })
    expect(parseNodaroMotionPreciseStyleRoute({ faceMeshLayers: "irises" }, warn)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })
})

// Which path a run with a photographic art style takes (`photographicStyles`, 2026-11-06): "flex" (the default, routed
// as every style) or "precise" (not routed, the Precise run routing "off" makes). Stored only when "precise".
describe("nodaro-motion-precise-style-route: photographicStyles", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves the two paths, Flex (the default) left out", () => {
    expect(parse({ photographicStyles: "precise" }).data).toEqual({ photographicStyles: "precise" })
    expect(parse({ photographicStyles: "flex" }).data).toEqual({ photographicStyles: "flex" })
    expect(withoutDefaultPreciseStyleRoute({ photographicStyles: "flex" })).toEqual({})
    expect(withoutDefaultPreciseStyleRoute({ photographicStyles: "precise", routing: "off" })).toEqual({ routing: "off", photographicStyles: "precise" })
    for (const bad of ["Precise", "motion", true, null]) expect(parse({ photographicStyles: bad }).success).toBe(false)
  })

  it("is answered to the engine when Precise; Flex is no difference", () => {
    expect(preciseStyleRouteForPlugin({ photographicStyles: "precise" })).toEqual({ photographicStyles: "precise" })
    expect(preciseStyleRouteForPlugin({ photographicStyles: "flex" })).toBeNull()
    expect(preciseStyleRouteForPlugin(null)).toBeNull()
  })

  it("survives the whole trip: saved, stored, read back and answered to the engine", () => {
    const saved = withoutDefaultPreciseStyleRoute(parse({ photographicStyles: "precise", bypassEmails: ["A@example.com"] }).data)
    const stored = JSON.parse(JSON.stringify(saved)) as unknown
    expect(preciseStyleRouteForPlugin(parseNodaroMotionPreciseStyleRoute(stored))).toEqual({ bypassEmails: ["a@example.com"], photographicStyles: "precise" })
  })

  it("reads tolerantly: a value of neither kind is dropped (Flex) with a warning, the other fields kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ photographicStyles: "precise" }, warn)).toEqual({ photographicStyles: "precise" })
    expect(parseNodaroMotionPreciseStyleRoute({ photographicStyles: "flex" }, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreciseStyleRoute({ photographicStyles: "real", routing: "off" }, warn)).toEqual({ routing: "off" })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// Which path each art style takes (`styleRoutes`): a style's id to "precise" (kept Precise) or "precise-gray" (kept
// Precise, its sent clip in black and white); a style left out takes "flex", the default, which is never stored. Beside the older
// `photographicStyles`, which stays readable.
describe("nodaro-motion-precise-style-route: styleRoutes", () => {
  const parse = (v: unknown) => nodaroMotionPreciseStyleRouteSchema.safeParse(v)

  it("saves a style's route; refuses Flex (the default, never stored) and a key that is not a style id", () => {
    expect(parse({ styleRoutes: { cyberpunk: "precise-gray", noir: "precise" } }).data).toEqual({ styleRoutes: { cyberpunk: "precise-gray", noir: "precise" } })
    expect(parse({ styleRoutes: {} }).success).toBe(true)
    expect(parse({ styleRoutes: { cyberpunk: "flex" } }).success).toBe(false)
    for (const key of ["Bad Id", "", "UPPER", "a".repeat(65), "under_score"]) expect(parse({ styleRoutes: { [key]: "precise" } }).success).toBe(false)
    expect(parse({ styleRoutes: { ["a".repeat(64)]: "precise" } }).success).toBe(true)
    expect(parse({ styleRoutes: ["precise"] }).success).toBe(false)
  })

  it("keeps the older photographic path beside it", () => {
    expect(parse({ photographicStyles: "precise", styleRoutes: { cyberpunk: "precise" } }).data).toEqual({ photographicStyles: "precise", styleRoutes: { cyberpunk: "precise" } })
  })

  it("leaves an empty map out, and copies a kept one", () => {
    expect(withoutDefaultPreciseStyleRoute({ styleRoutes: {} })).toEqual({})
    const given = { styleRoutes: { cyberpunk: "precise-gray" as const } }
    const kept = withoutDefaultPreciseStyleRoute(given)
    expect(kept).toEqual(given)
    expect(kept.styleRoutes).not.toBe(given.styleRoutes)
  })

  it("is answered to the engine; an empty map is no difference", () => {
    expect(preciseStyleRouteForPlugin({ styleRoutes: { cyberpunk: "precise-gray" } })).toEqual({ styleRoutes: { cyberpunk: "precise-gray" } })
    expect(preciseStyleRouteForPlugin({ styleRoutes: {}, photographicStyles: "precise" })).toEqual({ photographicStyles: "precise" })
    expect(preciseStyleRouteForPlugin({ styleRoutes: {} })).toBeNull()
  })

  it("reads tolerantly: valid entries kept, bad ones dropped with a warning, the other fields kept", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: { cyberpunk: "precise", noir: "precise-gray" } }, warn)).toEqual({ styleRoutes: { cyberpunk: "precise", noir: "precise-gray" } })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: { cyberpunk: "precise", x: 1, noir: "flex", "Bad Id": "precise" } }, warn)).toEqual({ styleRoutes: { cyberpunk: "precise" } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: { x: 1 }, routing: "off" }, warn)).toEqual({ routing: "off" })
    for (const bad of ["precise", ["cyberpunk"], 3]) expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: bad, routing: "off" }, warn)).toEqual({ routing: "off" })
    expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: null }, warn)).toEqual({})
  })

  it("survives the whole trip: saved, stored, read back and answered to the engine", () => {
    const saved = withoutDefaultPreciseStyleRoute(parse({ styleRoutes: { cyberpunk: "precise-gray" }, photographicStyles: "precise" }).data)
    const stored = JSON.parse(JSON.stringify(saved)) as unknown
    expect(preciseStyleRouteForPlugin(parseNodaroMotionPreciseStyleRoute(stored))).toEqual({ photographicStyles: "precise", styleRoutes: { cyberpunk: "precise-gray" } })
  })

  it("a style id starts with a letter or digit: '-', '---' and '-noir' are refused on save and dropped on read", () => {
    for (const key of ["-", "---", "-noir"]) {
      expect(parse({ styleRoutes: { [key]: "precise" } }).success, key).toBe(false)
      const warn = vi.fn()
      expect(parseNodaroMotionPreciseStyleRoute({ styleRoutes: { [key]: "precise", noir: "precise" } }, warn), key).toEqual({ styleRoutes: { noir: "precise" } })
      expect(warn, key).toHaveBeenCalledTimes(1)
    }
    expect(parse({ styleRoutes: { "noir-": "precise", "a-b--c": "precise-gray" } }).success).toBe(true)
  })

  it("every style id of the catalog is a valid key", () => {
    for (const s of STYLES) expect(STYLE_ROUTE_ID_PATTERN.test(s.id), s.id).toBe(true)
    expect(parse({ styleRoutes: Object.fromEntries(STYLES.map((s) => [s.id, "precise"])) }).success).toBe(true)
  })
})

// The Filmed styles: the video styles of the catalog whose medium is "photo", the admin table's Filmed group
// (StyleRoutesTable.tsx `filmedStyleIds`, pinned to this same list on its side).
describe("nodaro-motion-precise-style-route: the Filmed styles", () => {
  it("are the catalog's photographic video styles, in its order", () => {
    expect(filmedStyleIds()).toEqual(["cinematic", "noir", "photorealistic", "retro-vintage", "cyberpunk", "steampunk", "glitch-art", "early-color-photo"])
  })
})

// The answer to an engine that cannot read the per-style map (`castSwap.preciseStyleRoutePerStyle`, plugin 0.454.0):
// no map; the photographic path in its place when every Filmed style is "precise" in it ("precise-gray" does not count:
// such an engine cannot make black and white); a stored photographic path kept; null when nothing is left.
describe("nodaro-motion-precise-style-route: styleRoutesForEngine", () => {
  type CastSwap = { readonly preciseStyleRoute?: boolean; readonly preciseStyleRoutePerStyle?: boolean }
  const OLD: CastSwap = { preciseStyleRoute: true }
  const NEW: CastSwap = { preciseStyleRoute: true, preciseStyleRoutePerStyle: true }
  const allFilmed = (route: "precise" | "precise-gray") => Object.fromEntries(filmedStyleIds().map((id) => [id, route])) as Record<string, "precise" | "precise-gray">

  it("an engine reads the map only when it declares castSwap.preciseStyleRoutePerStyle", () => {
    expect(engineRoutesPerStyle(NEW)).toBe(true)
    for (const cs of [undefined, {}, OLD, { preciseStyleRoutePerStyle: false }] as Array<CastSwap | undefined>) expect(engineRoutesPerStyle(cs), JSON.stringify(cs)).toBe(false)
  })

  it("an older engine, every Filmed style Precise: the photographic path, no map", () => {
    const route: NodaroMotionPreciseStyleRoute = { routing: "off", styleRoutes: { ...allFilmed("precise"), anime: "precise-gray" }, routedDepthBlur: 6 }
    expect(styleRoutesForEngine(route, OLD)).toStrictEqual({ routing: "off", photographicStyles: "precise", routedDepthBlur: 6 })
    expect(styleRoutesForEngine({ styleRoutes: allFilmed("precise") }, undefined)).toStrictEqual({ photographicStyles: "precise" })
    // The answer is a new object: the route given is left as it was.
    expect(route.styleRoutes?.noir).toBe("precise")
  })

  it("an older engine, one Filmed style in black and white: no photographic path, no map", () => {
    expect(styleRoutesForEngine({ styleRoutes: { ...allFilmed("precise"), noir: "precise-gray" }, faceMesh: true }, OLD)).toStrictEqual({ faceMesh: true })
    expect(styleRoutesForEngine({ styleRoutes: allFilmed("precise-gray"), faceMesh: true }, OLD)).toStrictEqual({ faceMesh: true })
  })

  it("an older engine, one Filmed style left out (the Flex way): no photographic path, no map", () => {
    const { noir: _noir, ...rest } = allFilmed("precise")
    expect(styleRoutesForEngine({ styleRoutes: rest, routing: "off" }, OLD)).toStrictEqual({ routing: "off" })
  })

  it("an older engine, a stored photographic path alone: passed through", () => {
    expect(styleRoutesForEngine({ photographicStyles: "precise" }, OLD)).toStrictEqual({ photographicStyles: "precise" })
    // Beside a map that does not keep every Filmed style Precise, it is still kept.
    expect(styleRoutesForEngine({ photographicStyles: "precise", styleRoutes: { noir: "precise-gray" } }, OLD)).toStrictEqual({ photographicStyles: "precise" })
  })

  it("an engine that reads the map: the answer unchanged", () => {
    const route: NodaroMotionPreciseStyleRoute = { photographicStyles: "precise", styleRoutes: { ...allFilmed("precise"), anime: "precise-gray" } }
    expect(styleRoutesForEngine(route, NEW)).toBe(route)
    expect(styleRoutesForEngine(null, NEW)).toBeNull()
  })

  it("null when nothing is left once the map is taken out", () => {
    expect(styleRoutesForEngine({ styleRoutes: { anime: "precise" } }, OLD)).toBeNull()
    expect(styleRoutesForEngine({ styleRoutes: { noir: "precise-gray" } }, OLD)).toBeNull()
    expect(styleRoutesForEngine(null, OLD)).toBeNull()
  })

  it("from the stored row: what the engine is answered, end to end", () => {
    const stored = JSON.parse(JSON.stringify({ styleRoutes: allFilmed("precise"), bypassEmails: ["a@example.com"] })) as unknown
    expect(styleRoutesForEngine(preciseStyleRouteForPlugin(parseNodaroMotionPreciseStyleRoute(stored)), OLD)).toStrictEqual({ bypassEmails: ["a@example.com"], photographicStyles: "precise" })
  })
})

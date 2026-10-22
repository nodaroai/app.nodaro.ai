/**
 * Trend version data and run request validation (ee/lib/trends/schemas.ts).
 *
 * What must hold: slot keys are unique; chip defaults belong to the slot's
 * kind (person body/outfit/hair, pet body/coat, product shape/finish,
 * location none); the 4 s preview fits the clip; a trend can never ask for
 * more than 30 images in all; a run sends at most 3 images per slot.
 */
import { describe, it, expect } from "vitest"
import {
  maxImagesOf,
  misplacedChip,
  trendRunRequestSchema,
  trendVersionDataSchema,
} from "../schemas.js"
import type { TrendSlot, TrendVersionData } from "../types.js"

const IMG = "https://cdn.example.com/a.png"

function slot(key: string, kind: TrendSlot["kind"], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { key, label: { en: key }, kind, required: true, roleName: `the ${key}`, ...extra }
}

function data(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: { en: "Dance off", he: "קרב ריקודים" },
    source: { videoUrl: "https://cdn.example.com/src.mp4", durationSec: 30, width: 720, height: 1280 },
    previewStart: 0,
    slots: [slot("dancer", "person"), slot("room", "location")],
    references: [],
    examples: [],
    ...over,
  }
}

function messages(r: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] {
  return r.error?.issues.map((i) => i.message) ?? []
}

describe("trendVersionDataSchema", () => {
  it("accepts a valid trend version", () => {
    const r = trendVersionDataSchema.safeParse(data())
    expect(r.success).toBe(true)
  })

  it("accepts a draft with no source and no slots yet", () => {
    const r = trendVersionDataSchema.safeParse(data({ source: null, previewStart: null, slots: [] }))
    expect(r.success).toBe(true)
  })

  it("rejects duplicate slot keys", () => {
    const r = trendVersionDataSchema.safeParse(data({ slots: [slot("dancer", "person"), slot("dancer", "person")] }))
    expect(r.success).toBe(false)
    expect(messages(r).join(" ")).toMatch(/dancer/)
  })

  it("rejects a slot key outside ^[a-z0-9_]{1,32}$", () => {
    expect(trendVersionDataSchema.safeParse(data({ slots: [slot("Dancer", "person")] })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ slots: [slot("a".repeat(33), "person")] })).success).toBe(false)
  })

  it("rejects a built-in object property name as a slot key (it matches the pattern)", () => {
    for (const key of ["__proto__", "constructor"]) {
      const r = trendVersionDataSchema.safeParse(data({ slots: [slot(key, "person")] }))
      expect(r.success, key).toBe(false)
      expect(messages(r).join(" ")).toMatch(/built-in/)
    }
  })

  it("rejects a built-in object property name as an example's slot key", () => {
    // As a request body arrives: JSON.parse makes `__proto__` an own key.
    const slots = JSON.parse(`{"__proto__":["${IMG}"]}`) as Record<string, unknown>
    const example = { videoUrl: IMG, width: 1, height: 1, durationSec: 4, slots, sourceJobId: "j" }
    expect(trendVersionDataSchema.safeParse(data({ examples: [example] })).success).toBe(false)
  })

  describe("chip defaults are per kind", () => {
    it("accepts person body/outfit/hair, pet body/coat and product shape/finish", () => {
      const r = trendVersionDataSchema.safeParse(data({
        slots: [
          slot("dancer", "person", { defaults: { body: "original", outfit: "new", hair: "original" } }),
          slot("dog", "pet", { defaults: { body: "new", coat: "original" } }),
          slot("can", "product", { defaults: { shape: "original", finish: "new" } }),
        ],
      }))
      expect(r.success).toBe(true)
    })

    it("rejects a person chip on a product", () => {
      const r = trendVersionDataSchema.safeParse(data({ slots: [slot("can", "product", { defaults: { body: "new" } })] }))
      expect(r.success).toBe(false)
    })

    it("rejects a product chip on a person and a person chip on a pet", () => {
      expect(trendVersionDataSchema.safeParse(data({ slots: [slot("dancer", "person", { defaults: { shape: "new" } })] })).success).toBe(false)
      expect(trendVersionDataSchema.safeParse(data({ slots: [slot("dog", "pet", { defaults: { outfit: "new" } })] })).success).toBe(false)
    })

    it("rejects any defaults on a location", () => {
      expect(trendVersionDataSchema.safeParse(data({ slots: [slot("room", "location", { defaults: {} })] })).success).toBe(false)
      expect(trendVersionDataSchema.safeParse(data({ slots: [slot("room", "location", { defaults: { body: "new" } })] })).success).toBe(false)
    })

    it("rejects a value other than new / original", () => {
      expect(trendVersionDataSchema.safeParse(data({ slots: [slot("dancer", "person", { defaults: { body: "keep" } })] })).success).toBe(false)
    })
  })

  it("rejects previewStart 27 on a 30 s source (the 4 s preview must fit)", () => {
    const r = trendVersionDataSchema.safeParse(data({ previewStart: 27 }))
    expect(r.success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ previewStart: 26 })).success).toBe(true)
  })

  it("rejects a source clip outside 4–30 s", () => {
    expect(trendVersionDataSchema.safeParse(data({ previewStart: null, source: { videoUrl: "https://x.test/s.mp4", durationSec: 3 } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ previewStart: null, source: { videoUrl: "https://x.test/s.mp4", durationSec: 31 } })).success).toBe(false)
  })

  it("rejects 11 slots (33 images) with \"At most 30 images.\"", () => {
    // 6 person + 1 location + 3 product + 1 pet: every per-kind cap holds, so
    // the only failure is the 30-image total.
    const slots = [
      ...Array.from({ length: 6 }, (_, i) => slot(`p${i}`, "person")),
      slot("room", "location"),
      ...Array.from({ length: 3 }, (_, i) => slot(`prod${i}`, "product")),
      slot("dog", "pet"),
    ]
    const r = trendVersionDataSchema.safeParse(data({ slots }))
    expect(r.success).toBe(false)
    expect(messages(r)).toEqual(["At most 30 images."])
  })

  it("counts fixed reference images toward the 30", () => {
    // 9 slots (27) + 2 reference images = 29 passes; + 4 = 31 fails.
    const slots = [
      ...Array.from({ length: 6 }, (_, i) => slot(`p${i}`, "person")),
      slot("room", "location"),
      ...Array.from({ length: 2 }, (_, i) => slot(`prod${i}`, "product")),
    ]
    const ok = data({ slots, references: [{ images: [IMG, IMG], line: "the logo" }] })
    expect(trendVersionDataSchema.safeParse(ok).success).toBe(true)
    const tooMany = data({ slots, references: [{ images: [IMG, IMG], line: "a" }, { images: [IMG, IMG], line: "b" }] })
    expect(messages(trendVersionDataSchema.safeParse(tooMany))).toEqual(["At most 30 images."])
  })

  it("caps each kind: person 6, location 1, product 3, pet 3", () => {
    const many = (kind: TrendSlot["kind"], n: number) => Array.from({ length: n }, (_, i) => slot(`${kind}${i}`, kind))
    expect(trendVersionDataSchema.safeParse(data({ slots: many("person", 7) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ slots: many("location", 2) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ slots: many("product", 4) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ slots: many("pet", 4) })).success).toBe(false)
  })

  it("caps fixed references at 5, each with 1–3 images", () => {
    const ref = { images: [IMG], line: "the logo" }
    expect(trendVersionDataSchema.safeParse(data({ references: Array(6).fill(ref) })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ references: [{ images: [], line: "x" }] })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ references: [{ images: [IMG, IMG, IMG, IMG], line: "x" }] })).success).toBe(false)
  })

  it("requires an English name and accepts only the platform's locales", () => {
    expect(trendVersionDataSchema.safeParse(data({ name: { he: "שם" } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ name: { en: "x", xx: "y" } })).success).toBe(false)
  })

  it("caps the trend prompt at 3000 characters", () => {
    expect(trendVersionDataSchema.safeParse(data({ trendPrompt: "a".repeat(3000) })).success).toBe(true)
    expect(trendVersionDataSchema.safeParse(data({ trendPrompt: "a".repeat(3001) })).success).toBe(false)
  })

  it("rejects an example naming a slot the trend does not have", () => {
    const example = {
      videoUrl: "https://cdn.example.com/ex.mp4", width: 720, height: 1280, durationSec: 10,
      slots: { ghost: [IMG] }, sourceJobId: "00000000-0000-4000-8000-000000000001",
    }
    expect(trendVersionDataSchema.safeParse(data({ examples: [example] })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ examples: [{ ...example, slots: { dancer: [IMG] } }] })).success).toBe(true)
  })
})

describe("maxImagesOf", () => {
  it("is 3 per slot plus every reference image", () => {
    const d = trendVersionDataSchema.parse(data({ references: [{ images: [IMG, IMG], line: "x" }] })) as TrendVersionData
    expect(maxImagesOf(d)).toBe(3 * 2 + 2)
  })
})

describe("trendRunRequestSchema", () => {
  it("accepts a run with images and chips", () => {
    const r = trendRunRequestSchema.safeParse({
      slots: { dancer: { images: [IMG, IMG, IMG], body: "original", hair: "new" }, can: { shape: "new", finish: "original" } },
      example: 1,
      details: "make {slot:dancer} smile",
      preview: true,
      resolution: "720p",
      draft: false,
    })
    expect(r.success).toBe(true)
  })

  it("rejects 4 images in a slot", () => {
    const r = trendRunRequestSchema.safeParse({ slots: { dancer: { images: [IMG, IMG, IMG, IMG] } } })
    expect(r.success).toBe(false)
  })

  it("rejects a built-in object property name as a slot key", () => {
    for (const key of ["__proto__", "constructor", "toString"]) {
      // As a request body arrives: JSON.parse makes `__proto__` an own key.
      const body = JSON.parse(`{"slots":{"${key}":{"body":"new"}}}`) as unknown
      expect(trendRunRequestSchema.safeParse(body).success, key).toBe(false)
    }
  })

  it("leaves a slot key of any other shape to the trend (unknown_slot)", () => {
    expect(trendRunRequestSchema.safeParse({ slots: { Ghost: { body: "new" } } }).success).toBe(true)
  })

  it("rejects an unknown chip key", () => {
    expect(trendRunRequestSchema.safeParse({ slots: { dancer: { mood: "new" } } }).success).toBe(false)
  })

  it("rejects details over 1000 characters and example 0", () => {
    expect(trendRunRequestSchema.safeParse({ slots: {}, details: "a".repeat(1001) }).success).toBe(false)
    expect(trendRunRequestSchema.safeParse({ slots: {}, example: 0 }).success).toBe(false)
  })

  it("allows draft only at 480p", () => {
    expect(trendRunRequestSchema.safeParse({ slots: {}, resolution: "1080p", draft: true }).success).toBe(false)
    expect(trendRunRequestSchema.safeParse({ slots: {}, resolution: "480p", draft: true }).success).toBe(true)
    expect(trendRunRequestSchema.safeParse({ slots: {}, draft: true }).success).toBe(true)
  })
})

describe("misplacedChip", () => {
  const d = trendVersionDataSchema.parse(data({
    slots: [slot("dancer", "person"), slot("dog", "pet"), slot("can", "product"), slot("room", "location")],
  })) as TrendVersionData

  it("accepts each kind's own chips", () => {
    expect(misplacedChip({ slots: {
      dancer: { body: "new", outfit: "original", hair: "new" },
      dog: { body: "original", coat: "new" },
      can: { shape: "new", finish: "original" },
      room: { images: [IMG] },
    } }, d)).toBeNull()
  })

  it("names the slot and the chip that does not belong to its kind", () => {
    expect(misplacedChip({ slots: { dancer: { coat: "new" } } }, d)).toEqual({ slot: "dancer", chip: "coat" })
    expect(misplacedChip({ slots: { dog: { outfit: "new" } } }, d)).toEqual({ slot: "dog", chip: "outfit" })
    expect(misplacedChip({ slots: { can: { body: "new" } } }, d)).toEqual({ slot: "can", chip: "body" })
    expect(misplacedChip({ slots: { room: { shape: "new" } } }, d)).toEqual({ slot: "room", chip: "shape" })
  })

  it("leaves unknown slot keys to the caller", () => {
    expect(misplacedChip({ slots: { ghost: { coat: "new" } } }, d)).toBeNull()
  })
})

describe("trendVersionDataSchema — faceMasking and prePrompt", () => {
  const full = {
    mode: "auto",
    fill: "depth",
    minFaceHeightPct: 10,
    maxFaceHeightPct: 60,
    zone: { leftPct: 5, rightPct: 5, topPct: 0, bottomPct: 49 },
    blurStrengthPct: 2.5,
    threshold: 0.4,
  }

  it("accepts every mode, and the full setting", () => {
    for (const mode of ["off", "always", "auto"]) {
      expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode } })).success, mode).toBe(true)
    }
    const r = trendVersionDataSchema.safeParse(data({ faceMasking: full }))
    expect(r.success).toBe(true)
    expect(r.data?.faceMasking).toEqual(full)
  })

  it("stores a zone as given: left out stays left out (the default is filled in at run time), null stays null", () => {
    const omitted = trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "auto" } }))
    expect(omitted.success).toBe(true)
    expect(omitted.data?.faceMasking).toEqual({ mode: "auto" })
    const off = trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "auto", zone: null } }))
    expect(off.success).toBe(true)
    expect(off.data?.faceMasking).toEqual({ mode: "auto", zone: null })
  })

  it("refuses an unknown mode or fill, and an unknown key", () => {
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "sometimes" } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", fill: "pixelate" } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", holdLastMask: true } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", zone: { middlePct: 1 } } })).success).toBe(false)
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: {} })).success).toBe(false)
  })

  it("holds every number to its bounds", () => {
    const bad: Array<Record<string, unknown>> = [
      { minFaceHeightPct: -1 },
      { minFaceHeightPct: 101 },
      { maxFaceHeightPct: 101 },
      { zone: { leftPct: 50 } },
      { zone: { bottomPct: -1 } },
      { blurStrengthPct: 0.05 },
      { blurStrengthPct: 5.1 },
      { threshold: 0.01 },
      { threshold: 0.96 },
    ]
    for (const b of bad) {
      expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", ...b } })).success, JSON.stringify(b)).toBe(false)
    }
    const edges = { minFaceHeightPct: 0, maxFaceHeightPct: 100, zone: { leftPct: 49 }, blurStrengthPct: 0.1, threshold: 0.95 }
    expect(trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", ...edges } })).success).toBe(true)
  })

  it("needs max ≥ min when max is above 0 (min defaults to 15)", () => {
    const fm = (o: Record<string, unknown>) => trendVersionDataSchema.safeParse(data({ faceMasking: { mode: "always", ...o } })).success
    expect(fm({ minFaceHeightPct: 30, maxFaceHeightPct: 20 })).toBe(false)
    expect(fm({ maxFaceHeightPct: 10 })).toBe(false)
    expect(fm({ minFaceHeightPct: 30, maxFaceHeightPct: 30 })).toBe(true)
    expect(fm({ minFaceHeightPct: 30, maxFaceHeightPct: 0 })).toBe(true)
    expect(fm({ maxFaceHeightPct: 15 })).toBe(true)
  })

  it("takes a pre prompt of at most 3000 characters", () => {
    expect(trendVersionDataSchema.safeParse(data({ prePrompt: "a".repeat(3000) })).success).toBe(true)
    expect(trendVersionDataSchema.safeParse(data({ prePrompt: "a".repeat(3001) })).success).toBe(false)
  })
})

describe("trendRunRequestSchema — previewJobId", () => {
  it("takes a uuid and keeps it", () => {
    const id = "00000000-0000-4000-8000-0000000000f1"
    const r = trendRunRequestSchema.safeParse({ slots: {}, previewJobId: id })
    expect(r.success).toBe(true)
    expect(r.data?.previewJobId).toBe(id)
  })

  it("refuses anything that is not a uuid", () => {
    expect(trendRunRequestSchema.safeParse({ slots: {}, previewJobId: "job-1" }).success).toBe(false)
    expect(trendRunRequestSchema.safeParse({ slots: {}, previewJobId: 7 }).success).toBe(false)
  })
})

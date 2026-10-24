/**
 * Picker pictures over the API: every option that has a picture gets exactly
 * one absolute `imageUrl`, built from the installation's base URL (or, for
 * the rendered look previews, the Nodaro CDN — Cloud only); every option
 * without one gets none; the Person / Styling topics carry their pictures;
 * and the directory's `imageCount` agrees with what the detail call returns.
 */
import { describe, it, expect } from "vitest"
import {
  LOOK_PREVIEW_SETS,
  RENDER_WIDTH_LADDER,
  SOUND_ART,
  SOUND_RENDER_SETS,
  PERSON_DIMENSION_SECTIONS,
  PERSON_FIELD_BY_DIMENSION,
  STYLING_DIMENSION_ORDER,
  STYLING_DIMENSION_SECTIONS,
  STYLING_FIELD_BY_DIMENSION,
  characterArtPath,
  getRegisteredPickerCatalogs,
  lookPreviewStillUrl,
  pickerOptionImage,
  pickerOptionImageUrl,
  projectPickerCatalog,
  soundArtPath,
  summarizePickerCatalogs,
  type PickerCatalog,
  type PickerImageOptions,
} from "../index.js"
import type { ProjectedCatalogOption } from "@nodaro/shared/types"

const CLOUD: PickerImageOptions = { baseUrl: "https://app.nodaro.ai", lookPreviews: true }
const COMMUNITY: PickerImageOptions = { baseUrl: "http://localhost:3000", lookPreviews: false }

/** Every projected option of a catalog with the dimension field it belongs to. */
function projectedOptions(c: PickerCatalog, images?: PickerImageOptions) {
  const p = projectPickerCatalog(c, { images })
  return [
    ...(p.options ?? []).map((option) => ({ field: c.valueField, option })),
    ...(p.dimensions ?? []).flatMap((d) => d.options.map((option) => ({ field: d.field as string | undefined, option }))),
  ] as ReadonlyArray<{ field: string | undefined; option: ProjectedCatalogOption }>
}

type Sets = Readonly<Record<string, Readonly<Record<string, string>>>>

/** The picture an option should get, from the art maps directly (independent of the projection). */
function expectedUrl(c: PickerCatalog, field: string | undefined, id: string, images: PickerImageOptions): string | undefined {
  const base = images.baseUrl.replace(/\/+$/, "")
  const photo = characterArtPath(c.catalogId, id)
  if (photo) return base + photo
  const musicRender = images.lookPreviews ? (SOUND_RENDER_SETS as Sets)[c.catalogId]?.[id] : undefined
  if (musicRender) return lookPreviewStillUrl(musicRender)
  const own = field ? soundArtPath(c.catalogId, field, id) : undefined
  if (own) return base + own
  if (!images.lookPreviews) return undefined
  const render = (LOOK_PREVIEW_SETS as Sets)[c.nodeType]?.[id]
  return render ? lookPreviewStillUrl(render) : undefined
}

const CATALOGS = getRegisteredPickerCatalogs()

describe("picker option imageUrl", () => {
  it.each([["Cloud", CLOUD], ["a self-hosted install", COMMUNITY]] as const)(
    "on %s, every option gets exactly its picture (or none)",
    (_, images) => {
      const wrong: string[] = []
      for (const c of CATALOGS) {
        for (const { field, option } of projectedOptions(c, images)) {
          const expected = expectedUrl(c, field, option.id, images)
          if (option.imageUrl !== expected) wrong.push(`${c.nodeType}.${field}.${option.id}: ${option.imageUrl} ≠ ${expected}`)
          if (expected === undefined && "imageUrl" in option) wrong.push(`${c.nodeType}.${option.id}: an empty imageUrl key`)
        }
      }
      expect(wrong).toEqual([])
    },
  )

  it("self-hosted pictures are absolute on the installation's own host", () => {
    for (const images of [CLOUD, COMMUNITY]) {
      const own = CATALOGS.flatMap((c) => projectedOptions(c, images))
        .map(({ option }) => option.imageUrl)
        .filter((u): u is string => u !== undefined && !u.startsWith("https://cdn.nodaro.ai/"))
      expect(own.length).toBeGreaterThan(1000)
      expect(own.filter((u) => !u.startsWith(`${images.baseUrl}/picker-art/`))).toEqual([])
      expect(own.filter((u) => !/\.[0-9a-f]{8}\.webp$/.test(u))).toEqual([])
    }
  })

  it("a self-hosted install never gets a Nodaro CDN picture; Cloud does, for the look pickers", () => {
    const hostsOf = (images: PickerImageOptions) =>
      new Set(
        CATALOGS.flatMap((c) => projectedOptions(c, images))
          .map(({ option }) => option.imageUrl)
          .filter((u): u is string => u !== undefined)
          .map((u) => new URL(u).host),
      )
    expect([...hostsOf(COMMUNITY)]).toEqual(["localhost:3000"])
    expect([...hostsOf(CLOUD)].sort()).toEqual(["app.nodaro.ai", "cdn.nodaro.ai"])
    const mood = projectPickerCatalog(CATALOGS.find((c) => c.nodeType === "mood")!, { images: CLOUD })
    expect(mood.options?.every((o) => o.imageUrl?.startsWith("https://cdn.nodaro.ai/cdn-cgi/image/width=480,"))).toBe(true)
  })

  it("a camera-motion clip is pictured by a still frame, never the video", () => {
    const cm = projectPickerCatalog(CATALOGS.find((c) => c.nodeType === "camera-motion")!, { images: CLOUD })
    const urls = (cm.options ?? []).map((o) => o.imageUrl).filter((u): u is string => u !== undefined)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => u.includes("/cdn-cgi/media/mode=frame,") || u.includes("/cdn-cgi/image/"))).toBe(true)
  })

  it("a trailing slash on the base URL does not double the slash", () => {
    const withSlash = pickerOptionImageUrl({ nodeType: "person", catalogId: "person" }, "type", "man", { baseUrl: "http://localhost:3000/" })
    expect(withSlash).toBe(pickerOptionImageUrl({ nodeType: "person", catalogId: "person" }, "type", "man", COMMUNITY))
    expect(withSlash).toMatch(/^http:\/\/localhost:3000\/picker-art\/character\/person\/man\.[0-9a-f]{8}\.webp$/)
  })

  it("an unusable base URL yields no picture rather than a broken one", () => {
    for (const baseUrl of ["", "not a url", "javascript:alert(1)", "ftp://host"]) {
      expect(pickerOptionImageUrl({ nodeType: "person", catalogId: "person" }, "type", "man", { baseUrl })).toBeUndefined()
    }
  })

  it("without picture options, no option carries an imageUrl", () => {
    const any = CATALOGS.flatMap((c) => projectedOptions(c)).filter(({ option }) => "imageUrl" in option)
    expect(any).toEqual([])
  })

  it("imageUrl rides at both detail levels", () => {
    const person = CATALOGS.find((c) => c.nodeType === "person")!
    for (const detail of ["compact", "full"] as const) {
      const man = projectPickerCatalog(person, { detail, images: CLOUD }).dimensions?.[0]?.options.find((o) => o.id === "man")
      expect(man?.imageUrl).toMatch(/\/picker-art\/character\/person\/man\./)
    }
  })
})

describe("picker catalog sections (Person, Styling)", () => {
  it("person returns its topics, as fields, each with its round picture", () => {
    const p = projectPickerCatalog(CATALOGS.find((c) => c.nodeType === "person")!, { images: CLOUD })
    expect(p.sections?.map((s) => s.label)).toEqual(PERSON_DIMENSION_SECTIONS.map((s) => s.label))
    expect(p.sections?.[0]).toEqual({
      label: "Identity",
      fields: PERSON_DIMENSION_SECTIONS[0].dimensions.map((d) => PERSON_FIELD_BY_DIMENSION[d]),
      imageUrl: expect.stringMatching(/^https:\/\/app\.nodaro\.ai\/picker-art\/character\/sections\/identity\.[0-9a-f]{8}\.webp$/),
    })
  })

  it("styling returns its topics, as fields, each with its round picture", () => {
    const p = projectPickerCatalog(CATALOGS.find((c) => c.nodeType === "styling")!, { images: COMMUNITY })
    expect(p.sections?.map((s) => s.label)).toEqual(STYLING_DIMENSION_SECTIONS.map((s) => s.label))
    for (const [i, section] of (p.sections ?? []).entries()) {
      expect(section.fields).toEqual(STYLING_DIMENSION_SECTIONS[i].dimensions.map((d) => STYLING_FIELD_BY_DIMENSION[d]))
      expect(section.imageUrl).toMatch(/^http:\/\/localhost:3000\/picker-art\/character\/sections\//)
    }
  })

  it("every topic field is one of the catalog's dimensions", () => {
    for (const nodeType of ["person", "styling"]) {
      const p = projectPickerCatalog(CATALOGS.find((c) => c.nodeType === nodeType)!, {})
      const fields = new Set((p.dimensions ?? []).map((d) => d.field))
      expect(p.sections?.flatMap((s) => s.fields).filter((f) => !fields.has(f))).toEqual([])
      expect(p.sections?.every((s) => !("imageUrl" in s))).toBe(true) // no pictures without picture options
    }
  })

  it("other catalogs have no sections", () => {
    const others = CATALOGS.filter((c) => c.nodeType !== "person" && c.nodeType !== "styling")
    expect(others.filter((c) => projectPickerCatalog(c, { images: CLOUD }).sections !== undefined).map((c) => c.nodeType)).toEqual([])
  })

  it("STYLING_DIMENSION_SECTIONS lists every styling dimension exactly once", () => {
    const listed = STYLING_DIMENSION_SECTIONS.flatMap((s) => s.dimensions)
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual([...STYLING_DIMENSION_ORDER].sort())
  })
})

describe("picker catalog directory imageCount", () => {
  it.each([["Cloud", CLOUD], ["a self-hosted install", COMMUNITY]] as const)(
    "on %s, imageCount is the number of options the detail call pictures",
    (_, images) => {
      const summaries = summarizePickerCatalogs({ images })
      for (const c of CATALOGS) {
        const pictured = projectedOptions(c, images).filter(({ option }) => option.imageUrl).length
        expect(summaries.find((s) => s.nodeType === c.nodeType)?.imageCount, c.nodeType).toBe(pictured)
      }
    },
  )

  it("counts no picture without picture options", () => {
    expect(summarizePickerCatalogs().every((s) => s.imageCount === 0)).toBe(true)
  })

  it("the character, music and voice pickers are pictured everywhere; the look pickers on Cloud only", () => {
    const pictured = (images: PickerImageOptions) =>
      new Set(summarizePickerCatalogs({ images }).filter((s) => s.imageCount > 0).map((s) => s.nodeType))
    const everywhere = ["person", "styling", "held-prop", "material", "animal", "music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery"]
    expect([...pictured(COMMUNITY)].sort()).toEqual([...everywhere].sort())
    const cloud = pictured(CLOUD)
    expect(everywhere.every((t) => cloud.has(t))).toBe(true)
    for (const look of ["style", "mood", "lens", "framing", "lighting", "camera-motion"]) expect(cloud.has(look), look).toBe(true)
  })
})

describe("music / voice picker renders (SOUND_RENDER_SETS)", () => {
  const SOUND = ["music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery"] as const

  it("cover exactly the options of the five music / voice pickers, one render each", () => {
    // Every sound catalog has renders: a new one must ship its pictures (or change this list on purpose).
    expect(Object.keys(SOUND_ART).sort()).toEqual([...SOUND].sort())
    for (const catalogId of SOUND) {
      const ids = Object.values(SOUND_ART[catalogId] as Sets).flatMap((byId) => Object.keys(byId))
      // Keyed by option id alone: ids must be unique across a catalog's dimensions.
      expect(new Set(ids).size).toBe(ids.length)
      expect(Object.keys(SOUND_RENDER_SETS[catalogId]).sort()).toEqual([...ids].sort())
    }
    expect(Object.keys(SOUND_RENDER_SETS).sort()).toEqual([...SOUND].sort())
  })

  it("are distinct stills on the transforming CDN, under keys no look picker uses", () => {
    const urls = Object.values(SOUND_RENDER_SETS as Sets).flatMap((byId) => Object.values(byId))
    expect(urls.filter((u) => !/^https:\/\/cdn\.nodaro\.ai\/picker-renders\/[0-9a-f-]{36}\.png$/.test(u))).toEqual([])
    expect(new Set(urls).size).toBe(urls.length)
    expect(Object.keys(SOUND_RENDER_SETS).filter((k) => k in LOOK_PREVIEW_SETS)).toEqual([])
  })
})

describe("every picker render lives under the platform-owned prefix", () => {
  // picker-renders/ belongs to no user: no account deletion, retention reaper or
  // asset cleanup reaches it. A render left on a generation key (images/,
  // videos/) belongs to whoever generated it and vanishes with their asset —
  // copy it under picker-renders/ first (server-side copy in the same bucket).
  it("look previews and music / voice renders alike", () => {
    const urls = [LOOK_PREVIEW_SETS, SOUND_RENDER_SETS].flatMap((sets) =>
      Object.values(sets as Sets).flatMap((byId) => Object.values(byId)),
    )
    expect(urls.length).toBeGreaterThan(1000)
    expect(urls.filter((u) => !/^https:\/\/cdn\.nodaro\.ai\/picker-renders\/[0-9a-f-]{36}\.(png|mp4)$/.test(u))).toEqual([])
  })

  it("replace the emoji and flags on Cloud only", () => {
    const genre = { nodeType: "music-genre", catalogId: "music-genre" }
    expect(pickerOptionImageUrl(genre, "genre", "hip-hop", CLOUD)).toBe(lookPreviewStillUrl(SOUND_RENDER_SETS["music-genre"]["hip-hop"]))
    expect(pickerOptionImageUrl(genre, "genre", "hip-hop", COMMUNITY)).toMatch(/^http:\/\/localhost:3000\/picker-art\/emoji\//)
    const voice = { nodeType: "voice-character", catalogId: "voice-character" }
    expect(pickerOptionImageUrl(voice, "language", "english", CLOUD)).toBe(lookPreviewStillUrl(SOUND_RENDER_SETS["voice-character"].english))
    expect(pickerOptionImageUrl(voice, "language", "english", COMMUNITY)).toMatch(/^http:\/\/localhost:3000\/picker-art\/flags\//)
  })
})

describe("picker option imageSrcSet", () => {
  const CLOUD_SRCSET: PickerImageOptions = { ...CLOUD, srcSet: true }
  const rock = () => pickerOptionImage({ nodeType: "music-genre", catalogId: "music-genre" }, "genre", "rock", CLOUD_SRCSET)

  it("a CDN render offers every width of the ladder, its imageUrl being the 480px member", () => {
    const render = SOUND_RENDER_SETS["music-genre"].rock
    expect(rock()?.srcSet).toBe(RENDER_WIDTH_LADDER.map((w) => `${lookPreviewStillUrl(render, w)} ${w}w`).join(", "))
    expect(rock()?.srcSet).toContain(`${rock()?.url} 480w`)
  })

  it("is left out unless asked for (the MCP tools do not ask), and changes nothing else", () => {
    const plain = pickerOptionImage({ nodeType: "music-genre", catalogId: "music-genre" }, "genre", "rock", CLOUD)
    expect(plain).toEqual({ url: rock()?.url })
    const any = CATALOGS.flatMap((c) => projectedOptions(c, CLOUD)).filter(({ option }) => "imageSrcSet" in option)
    expect(any).toEqual([])
  })

  it("rides beside imageUrl for every CDN picture, at both detail levels, and never for a self-hosted one", () => {
    const wrong: string[] = []
    for (const images of [CLOUD_SRCSET, { ...COMMUNITY, srcSet: true }]) {
      for (const c of CATALOGS) {
        for (const detail of ["compact", "full"] as const) {
          const p = projectPickerCatalog(c, { detail, images })
          for (const o of [...(p.options ?? []), ...(p.dimensions ?? []).flatMap((d) => d.options)]) {
            const cdn = o.imageUrl?.startsWith("https://cdn.nodaro.ai/") === true
            if ("imageSrcSet" in o !== cdn) wrong.push(`${detail} ${c.nodeType}.${o.id}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

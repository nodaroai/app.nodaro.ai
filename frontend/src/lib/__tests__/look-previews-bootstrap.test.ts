// The rendered look previews live on the Nodaro CDN, so only the Cloud edition
// may register them: a self-hosted install (Community / Business) must never
// call the CDN and keeps the drawn previews. Above both, the deployment's
// `catalogs.images`: anything but "default" shows no platform picture at all —
// no render, and none of the self-hosted photos, emoji and flags.
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("@/lib/edition")
  delete window.__NODARO_RUNTIME__
})

async function boot(cloud: boolean, images?: unknown) {
  vi.doMock("@/lib/edition", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/edition")>()),
    isCloud: () => cloud,
  }))
  if (images !== undefined) window.__NODARO_RUNTIME__ = { surface: { catalogs: { required: false, factoryPresets: true, images } } } as never
  const ui = await import("@nodaro/picker-ui")
  ui.resetLookPreviewsForTests()
  ui.resetPlatformPickerPicturesForTests()
  ui.resetOwnPickerPicturesForTests()
  const { bootstrapLookPreviews, applyServerPickerPictures } = await import("@/lib/look-previews-bootstrap")
  bootstrapLookPreviews()
  return { ...ui, applyServerPickerPictures }
}

type PickerUi = Awaited<ReturnType<typeof boot>>

function rendersRegistered(ui: PickerUi): string[] {
  return [...Object.keys(ui.LOOK_PREVIEW_SETS), ...Object.keys(ui.SOUND_RENDER_SETS)].filter((key) => ui.hasLookPreviews(key))
}

function selfHostedPictures(ui: PickerUi): Array<string | boolean | undefined> {
  return [
    ui.characterArtUrl("person", "man"),
    ui.characterSectionIconUrl("Identity"),
    ui.hasCharacterArt("styling"),
  ]
}

describe("bootstrapLookPreviews", () => {
  it("registers the renders in the Cloud edition", async () => {
    const ui = await boot(true)
    expect(ui.hasLookPreviews("style")).toBe(true)
    expect(ui.getLookPreviewUrl("lens", "fisheye")).toMatch(/^https:\/\/cdn\.nodaro\.ai\//)
  })

  it("registers the music / voice pickers' pictures in the Cloud edition, under their catalog ids", async () => {
    const ui = await boot(true)
    for (const key of Object.keys(ui.SOUND_RENDER_SETS)) expect(ui.hasLookPreviews(key), key).toBe(true)
    expect(ui.getLookPreviewUrl("music-genre", "hip-hop")).toMatch(/^https:\/\/cdn\.nodaro\.ai\/picker-renders\//)
  })

  it("registers nothing in a self-hosted edition", async () => {
    const ui = await boot(false)
    expect(rendersRegistered(ui)).toEqual([])
  })

  it("keeps the self-hosted pictures in every edition", async () => {
    for (const cloud of [true, false]) {
      const ui = await boot(cloud)
      const [photo, icon, hasArt] = selfHostedPictures(ui)
      expect(photo, `cloud=${cloud}`).toMatch(/^\/picker-art\/character\/person\/man\.[0-9a-f]{8}\.webp$/)
      expect(icon, `cloud=${cloud}`).toMatch(/^\/picker-art\/character\/sections\//)
      expect(hasArt, `cloud=${cloud}`).toBe(true)
      vi.resetModules()
    }
  })

  it('"default" is the same as no setting', async () => {
    const ui = await boot(true, "default")
    expect(rendersRegistered(ui).length).toBeGreaterThan(10)
    expect(selfHostedPictures(ui).every(Boolean)).toBe(true)
  })
})

describe("bootstrapLookPreviews under catalogs.images", () => {
  // "own" shows none until the deployment's own pictures arrive with the
  // server's catalogs (below); a value this build does not know reads as "none".
  for (const images of ["none", "own", "platform", 7]) {
    for (const cloud of [true, false]) {
      it(`${JSON.stringify(images)} (${cloud ? "Cloud" : "self-hosted"}): no render and no self-hosted picture`, async () => {
        const ui = await boot(cloud, images)
        expect(rendersRegistered(ui)).toEqual([])
        expect(selfHostedPictures(ui)).toEqual([undefined, undefined, false])
        expect(ui.platformPickerPicturesShown()).toBe(false)
      })
    }
  }
})

describe("applyServerPickerPictures: a deployment's own pictures, from GET /v1/catalogs", () => {
  const MEDIA = "https://media.example.com/p"
  /** A trimmed catalog projection as the server sends it under "own". */
  const REPLY = [
    {
      nodeType: "camera-motion",
      catalogId: "camera-motions",
      kind: "single",
      options: [
        { id: "dolly-in", label: "Dolly in", imageUrl: `${MEDIA}/dolly.webp`, imageLargeUrl: `${MEDIA}/dolly.large.webp` },
        { id: "pan-left", label: "Pan left" },
      ],
    },
    {
      nodeType: "person",
      catalogId: "person",
      kind: "multi",
      dimensions: [{ field: "type", label: "Type", options: [{ id: "man", label: "Man", imageUrl: `${MEDIA}/man.webp` }] }],
    },
    { nodeType: "music-genre", catalogId: "music-genre", kind: "multi", dimensions: [{ field: "genres", label: "Genres", options: [{ id: "hip-hop", label: "Hip Hop", imageUrl: "http://media.example.com/insecure.webp" }] }] },
    // A picker the editor draws no platform picture for: the API serves it, the editor has no slot.
    { nodeType: "setting", catalogId: "setting", kind: "single", options: [{ id: "coffee-shop", label: "Coffee Shop", imageUrl: `${MEDIA}/cafe.webp` }] },
  ]

  it('"own": the editor shows exactly the pictures the reply carries, the enlarged one included', async () => {
    {
      const ui = await boot(true, "own")
      expect(ui.applyServerPickerPictures(REPLY)).toBe(3)
      expect(ui.getLookPreviewUrl("camera-motion", "dolly-in")).toBe(`${MEDIA}/dolly.webp`)
      expect(ui.getLookPreviewLargeUrl("camera-motion", "dolly-in")).toBe(`${MEDIA}/dolly.large.webp`)
      expect(ui.getLookPreviewUrl("camera-motion", "pan-left")).toBeUndefined()
      expect(ui.characterArtUrl("person", "man")).toBe(`${MEDIA}/man.webp`)
      expect(ui.hasCharacterArt("person")).toBe(true)
      // Not https: not taken.
      expect(ui.getLookPreviewUrl("music-genre", "hip-hop")).toBeUndefined()
      // Only where the platform's picture would be: a character picker never turns into a look picker,
      // and a picker the editor pictures nowhere gets no picture slot.
      expect(ui.hasLookPreviews("person")).toBe(false)
      expect(ui.hasLookPreviews("setting")).toBe(false)
      expect(ui.getLookPreviewUrl("setting", "coffee-shop")).toBeUndefined()
      // Never the platform's: no render, no self-hosted photo, no topic icon.
      expect(ui.characterArtUrl("person", "woman")).toBeUndefined()
      expect(ui.characterSectionIconUrl("Identity")).toBeUndefined()
      expect(rendersRegistered(ui).filter((key) => key !== "camera-motion")).toEqual([])
    }
  })

  it('"own" with a reply that pictures nothing (none registered): nothing, as before', async () => {
    const ui = await boot(true, "own")
    expect(ui.applyServerPickerPictures(undefined)).toBe(0)
    expect(ui.applyServerPickerPictures([{ nodeType: "lens", catalogId: "lens", options: [{ id: "fisheye", label: "Fisheye" }] }])).toBe(0)
    expect(rendersRegistered(ui)).toEqual([])
    expect(selfHostedPictures(ui)).toEqual([undefined, undefined, false])
  })

  for (const images of [undefined, "default", "none", "platform"]) {
    it(`${JSON.stringify(images ?? "no setting")}: takes nothing from the reply`, async () => {
      const ui = await boot(true, images)
      const before = [ui.getLookPreviewUrl("camera-motion", "dolly-in"), ui.characterArtUrl("person", "man")]
      expect(ui.applyServerPickerPictures(REPLY)).toBe(0)
      expect([ui.getLookPreviewUrl("camera-motion", "dolly-in"), ui.characterArtUrl("person", "man")]).toEqual(before)
      expect(JSON.stringify(before)).not.toContain("media.example.com")
    })
  }
})

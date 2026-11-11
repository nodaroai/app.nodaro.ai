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
  const { bootstrapLookPreviews } = await import("@/lib/look-previews-bootstrap")
  bootstrapLookPreviews()
  return ui
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
  // "own" has no registry of the deployment's pictures yet, so it shows none;
  // a value this build does not know reads as "none".
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

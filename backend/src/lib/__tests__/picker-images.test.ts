/**
 * pickerImageOptions — the one server-side decision of which pictures the
 * picker catalog replies carry (lib/picker-images.ts).
 *
 * Without the setting, and with `catalogs.images: "default"`, it is pinned to
 * the exact options every catalog reply was built from before the setting
 * existed, so such an install answers byte for byte as before. "none" and
 * "own" picture nothing, on every edition that reads the surface profile;
 * Community does not read it, so its pictures never change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({ edition: "cloud", publicUrl: "" }))

vi.mock("../config.js", () => ({
  config: {
    get EDITION() {
      return env.edition
    },
    get PUBLIC_URL() {
      return env.publicUrl
    },
    R2_PUBLIC_URL: "https://media.example.com",
    R2_PUBLIC_FALLBACK_DOMAIN: "",
  },
  isCloud: () => env.edition === "cloud",
  isBusiness: () => env.edition === "business",
}))

import { ownPickerPicturesShown, pickerImageOptions } from "../picker-images.js"
import { registerPickerPictures, resetPickerPicturesForTests } from "../picker-pictures.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const savedProfile = process.env.NODARO_SURFACE_PROFILE

function setProfile(profile: string | undefined): void {
  if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = profile
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  env.edition = "cloud"
  env.publicUrl = ""
  setProfile(undefined)
})
afterEach(() => {
  resetPickerPicturesForTests()
  setProfile(savedProfile)
  vi.restoreAllMocks()
})

/** Each install shape, and the options its catalog replies were built from before the setting. */
const INSTALLS = [
  { name: "Cloud on its own app host", edition: "cloud", publicUrl: "", baseUrl: "https://app.nodaro.ai", lookPreviews: true },
  { name: "Cloud with PUBLIC_URL", edition: "cloud", publicUrl: "https://studio.example.com/", baseUrl: "https://studio.example.com", lookPreviews: true },
  { name: "Business", edition: "business", publicUrl: "https://biz.example.com", baseUrl: "https://biz.example.com", lookPreviews: false },
  { name: "Community", edition: "community", publicUrl: "http://localhost:3000", baseUrl: "http://localhost:3000", lookPreviews: false },
] as const

function each(fn: (install: (typeof INSTALLS)[number]) => void): void {
  for (const install of INSTALLS) {
    env.edition = install.edition
    env.publicUrl = install.publicUrl
    __resetSurfaceProfileCacheForTests()
    fn(install)
  }
}

describe("no setting: the platform's pictures, exactly as before", () => {
  it("gives every install the options its replies were built from", () => {
    each((install) => {
      expect(pickerImageOptions(), install.name).toStrictEqual({ baseUrl: install.baseUrl, lookPreviews: install.lookPreviews, srcSet: false })
      expect(pickerImageOptions({ srcSet: true }), install.name).toStrictEqual({
        baseUrl: install.baseUrl,
        lookPreviews: install.lookPreviews,
        srcSet: true,
      })
    })
  })

  it("an empty NODARO_SURFACE_PROFILE is no setting", () => {
    for (const blank of ["", "   "]) {
      setProfile(blank)
      each((install) => {
        expect(pickerImageOptions({ srcSet: true }), install.name).toStrictEqual({ baseUrl: install.baseUrl, lookPreviews: install.lookPreviews, srcSet: true })
      })
    }
  })
})

describe('"default", or a profile without the key: the same options as no setting', () => {
  const PROFILES = {
    '"images": "default"': JSON.stringify({ catalogs: { images: "default" } }),
    "a profile without the key": JSON.stringify({ brand: { productName: "Acme" }, catalogs: { required: true, factoryPresets: false } }),
    "a profile with no catalogs at all": JSON.stringify({ brand: { productName: "Acme" } }),
  }

  for (const [label, profile] of Object.entries(PROFILES)) {
    it(label, () => {
      each((install) => {
        setProfile(undefined)
        const unset = [pickerImageOptions(), pickerImageOptions({ srcSet: true })]
        setProfile(profile)
        expect([pickerImageOptions(), pickerImageOptions({ srcSet: true })], install.name).toStrictEqual(unset)
      })
    })
  }
})

describe('"none" and "own": no pictures', () => {
  for (const images of ["none", "own"]) {
    it(`"${images}" pictures nothing on Cloud and Business`, () => {
      setProfile(JSON.stringify({ catalogs: { images } }))
      each((install) => {
        if (install.edition === "community") return
        expect(pickerImageOptions(), install.name).toBeUndefined()
        expect(pickerImageOptions({ srcSet: true }), install.name).toBeUndefined()
      })
    })
  }

  it("a value it does not know pictures nothing (the profile reads it as \"none\")", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    setProfile(JSON.stringify({ catalogs: { images: "platform" } }))
    expect(pickerImageOptions({ srcSet: true })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("catalogs.images"))
  })

  it("Community ignores the surface profile, so its pictures stay", () => {
    env.edition = "community"
    env.publicUrl = "http://localhost:3000"
    for (const images of ["none", "own"]) {
      setProfile(JSON.stringify({ catalogs: { images } }))
      expect(pickerImageOptions({ srcSet: true })).toStrictEqual({ baseUrl: "http://localhost:3000", lookPreviews: false, srcSet: true })
    }
  })
})

describe("a deployment's own pictures (registered at its composition root)", () => {
  const PICTURE = "https://media.example.com/p/cinematic.webp"
  const LARGE = "https://media.example.com/p/cinematic.large.webp"
  const register = () =>
    registerPickerPictures([
      { catalogId: "style", optionId: "cinematic", pictureUrl: PICTURE, enlargedPictureUrl: LARGE },
      { catalogId: "person", optionId: "man", pictureUrl: "https://media.example.com/p/man.webp" },
    ])

  it('"own" with nothing registered is still exactly "none"', () => {
    setProfile(JSON.stringify({ catalogs: { images: "own" } }))
    expect(pickerImageOptions({ srcSet: true })).toBeUndefined()
    expect(ownPickerPicturesShown()).toBe(false)
  })

  it('"own": the registered pictures, and nothing of the platform\'s', () => {
    register()
    setProfile(JSON.stringify({ catalogs: { images: "own" } }))
    each((install) => {
      if (install.edition === "community") return
      const rest = pickerImageOptions({ srcSet: true })!
      expect(rest.lookPreviews, install.name).toBeUndefined()
      expect(rest.srcSet).toBe(true)
      expect(rest.own?.("style", "cinematic")).toEqual({ url: PICTURE, largeUrl: LARGE })
      expect(rest.own?.("person", "man")).toEqual({ url: "https://media.example.com/p/man.webp" })
      expect(rest.own?.("style", "anime")).toBeUndefined()
      expect(rest.own?.("person", "cinematic")).toBeUndefined()
      expect(pickerImageOptions()!.srcSet).toBe(false)
      expect(ownPickerPicturesShown()).toBe(true)
    })
  })

  it('"none": registered pictures are not shown either', () => {
    register()
    setProfile(JSON.stringify({ catalogs: { images: "none" } }))
    expect(pickerImageOptions({ srcSet: true })).toBeUndefined()
    expect(ownPickerPicturesShown()).toBe(false)
  })

  it('"default" (or no setting): the platform\'s pictures, exactly as before; registered ones are ignored', () => {
    for (const profile of [undefined, JSON.stringify({ catalogs: { images: "default" } })]) {
      each((install) => {
        resetPickerPicturesForTests()
        setProfile(profile)
        const before = [pickerImageOptions(), pickerImageOptions({ srcSet: true })]
        register()
        expect([pickerImageOptions(), pickerImageOptions({ srcSet: true })], install.name).toStrictEqual(before)
        expect(ownPickerPicturesShown()).toBe(false)
      })
    }
  })

  it("Community does not read the profile, so registered pictures never show there", () => {
    register()
    env.edition = "community"
    env.publicUrl = "http://localhost:3000"
    setProfile(JSON.stringify({ catalogs: { images: "own" } }))
    expect(pickerImageOptions({ srcSet: true })).toStrictEqual({ baseUrl: "http://localhost:3000", lookPreviews: false, srcSet: true })
  })
})

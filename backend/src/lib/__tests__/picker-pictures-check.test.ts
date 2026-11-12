/**
 * The boot check on a deployment's own picker pictures (lib/picker-pictures-check.ts),
 * run by the overlay loader once the overlay's register() has returned:
 *
 *  - every entry's catalog must be a picker catalog, and its option an option
 *    of that catalog AS COMPOSED — base catalogs plus every registered catalog
 *    pack, in whatever order register() made its calls. Anything else is a
 *    problem (the loader refuses the boot, every problem in one message);
 *  - an option with no picture is not a problem: the summary line says how
 *    many options of how many have one, per catalog, once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerCatalogPack, resetCatalogPacks } from "@nodaro/prompts/catalog-packs"
import { getPickerCatalog } from "@nodaro/prompts/picker-catalogs"

const env = vi.hoisted(() => ({ edition: "cloud" }))

vi.mock("../config.js", () => ({
  config: {
    R2_PUBLIC_URL: "https://media.example.com",
    R2_PUBLIC_FALLBACK_DOMAIN: "",
    PUBLIC_URL: "",
    get EDITION() {
      return env.edition
    },
  },
  isCloud: () => env.edition === "cloud",
  isBusiness: () => env.edition === "business",
}))

import { pickerPictureProblems, pickerPictureSummary } from "../picker-pictures-check.js"
import { registerPickerPictures, resetPickerPicturesForTests } from "../picker-pictures.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const savedProfile = process.env.NODARO_SURFACE_PROFILE
const url = (name: string) => `https://media.example.com/pictures/${name}.webp`

function optionCount(catalogId: string): number {
  const c = getPickerCatalog(catalogId === "camera-motions" ? "camera-motion" : catalogId)!
  return (c.options ?? []).length + (c.dimensions ?? []).reduce((n, d) => n + d.options.length, 0)
}

function setImages(images: string | undefined): void {
  if (images === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ catalogs: { images } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  env.edition = "cloud"
  setImages("own")
})
afterEach(() => {
  resetPickerPicturesForTests()
  resetCatalogPacks()
  if (savedProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = savedProfile
  __resetSurfaceProfileCacheForTests()
})

describe("nothing registered", () => {
  it("no problem and no summary line", () => {
    expect(pickerPictureProblems()).toEqual([])
    expect(pickerPictureSummary()).toBeUndefined()
  })
})

describe("problems", () => {
  it("none for options of real catalogs, single- and multi-dimension", () => {
    registerPickerPictures([
      { catalogId: "style", optionId: "cinematic", pictureUrl: url("a") },
      { catalogId: "person", optionId: "man", pictureUrl: url("b") },
      { catalogId: "camera-motions", optionId: "dolly-in", pictureUrl: url("c") },
    ])
    expect(pickerPictureProblems()).toEqual([])
  })

  it("an unknown catalog id", () => {
    registerPickerPictures([{ catalogId: "no-such-catalog", optionId: "x", pictureUrl: url("a") }])
    expect(pickerPictureProblems()).toEqual(['"no-such-catalog/x": no picker catalog "no-such-catalog" on this deployment'])
  })

  it("a node type is not a catalog id", () => {
    registerPickerPictures([{ catalogId: "camera-motion", optionId: "dolly-in", pictureUrl: url("a") }])
    expect(pickerPictureProblems()).toEqual(['"camera-motion/dolly-in": no picker catalog "camera-motion" on this deployment'])
  })

  it("an unknown option id, every one in the list", () => {
    registerPickerPictures([
      { catalogId: "style", optionId: "no-such-style", pictureUrl: url("a") },
      { catalogId: "person", optionId: "no-such-person", pictureUrl: url("b") },
    ])
    expect(pickerPictureProblems()).toEqual([
      '"style/no-such-style": "no-such-style" is not an option of this deployment\'s "style" catalog',
      '"person/no-such-person": "no-such-person" is not an option of this deployment\'s "person" catalog',
    ])
  })

  it("judged against the catalogs as the deployment's catalog packs left them, registered before or after", () => {
    registerPickerPictures([
      { catalogId: "setting", optionId: "own-harbor", pictureUrl: url("a") },
      { catalogId: "style", optionId: "cinematic", pictureUrl: url("b") },
    ])
    expect(pickerPictureProblems()).toHaveLength(1)
    // Registered after the pictures, as register() may order its calls.
    registerCatalogPack({
      id: "own-pictures-check-test",
      catalogId: "setting",
      mode: "extend",
      options: [{ id: "own-harbor", label: "Harbor", description: "A harbor", category: "Outdoor", promptHint: "a harbor" }],
    })
    registerCatalogPack({ id: "own-pictures-check-deny", catalogId: "style", mode: "deny", denyIds: ["cinematic"] })
    expect(pickerPictureProblems()).toEqual(['"style/cinematic": "cinematic" is not an option of this deployment\'s "style" catalog'])
  })
})

describe("the summary line", () => {
  it("counts the options that have a picture, of how many, per catalog with one; the rest are not errors", () => {
    registerPickerPictures([
      { catalogId: "style", optionId: "cinematic", pictureUrl: url("a") },
      { catalogId: "style", optionId: "anime", pictureUrl: url("b"), enlargedPictureUrl: url("b-large") },
      { catalogId: "person", optionId: "man", pictureUrl: url("c") },
    ])
    const line = pickerPictureSummary()!
    expect(line).not.toContain("\n")
    expect(line).toContain(`style ${2} of ${optionCount("style")}`)
    expect(line).toContain(`person ${1} of ${optionCount("person")}`)
    expect(line).toMatch(/^own pictures for 3 of \d+ picker options: /)
    expect(line).toMatch(/\(\d+ other catalogs have none\)/)
    expect(line).not.toContain("not shown")
  })

  it('says so when they are not shown: catalogs.images is not "own"', () => {
    registerPickerPictures([{ catalogId: "style", optionId: "cinematic", pictureUrl: url("a") }])
    for (const images of [undefined, "default", "none"]) {
      setImages(images)
      expect(pickerPictureSummary(), String(images)).toMatch(/not shown: this deployment's catalogs\.images is not "own"$/)
    }
  })
})

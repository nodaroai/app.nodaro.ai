/**
 * A style's medium, tones and media (`Style.medium` / `tones` / `media`):
 * - every style classifies itself; the 49 styles offered for images and video
 *   keep exactly the medium and tones Nodaro Motion's art-style line has read
 *   them with so far (its own id lists), so moving them into the catalog
 *   changes no prompt;
 * - the video-only styles are rendered 3D looks, offered for video alone;
 * - image style lists leave them out, and the wire carries `media` so a thin
 *   client can do the same.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  STYLES,
  STYLE_MEDIUMS,
  getStyleMedium,
  getStyleTones,
  styleOffersMedia,
  stylesForMedia,
  styleOffersRestyle,
  stylesForRestyle,
  getPickerCatalog,
  projectPickerCatalog,
  registerCatalogPack,
  resetCatalogPacks,
} from "../index.js"

afterEach(() => resetCatalogPacks())

/** Nodaro Motion's lists as they read the 49 styles before the catalog carried a medium. */
const PHOTOGRAPHIC = ["photorealistic", "cinematic", "noir", "early-color-photo", "retro-vintage", "cyberpunk", "steampunk", "glitch-art"]
const RENDERED = ["3d-render", "low-poly", "isometric", "pixar-3d", "claymation"]
const BLACK_AND_WHITE = ["noir", "manga", "pencil-sketch", "charcoal", "etching", "woodcut", "ink-wash"]
const ONE_COLOUR = ["blueprint", "ascii-art", "chalkboard"]
const VIDEO_ONLY = ["felt-puppet", "knitted-yarn", "toy-figure-3d", "painterly-3d", "painted-clay"]
/** Left out of restyle lists: in tests each came out as the same plain 2D cartoon, without its own look. */
const NOT_FOR_RESTYLE = ["fantasy", "concept-art", "surrealism"]

const both = STYLES.filter((s) => s.media === undefined)

describe("medium and tones", () => {
  it("every style declares a known medium", () => {
    for (const s of STYLES) expect(STYLE_MEDIUMS, s.id).toContain(s.medium)
  })

  it("the 49 styles for images and video keep the medium Nodaro Motion read them with", () => {
    expect(both).toHaveLength(49)
    for (const s of both) {
      const expected = PHOTOGRAPHIC.includes(s.id) ? "photo" : RENDERED.includes(s.id) ? "3d" : "2d"
      expect(getStyleMedium(s.id), s.id).toBe(expected)
    }
  })

  it("tones: black and white, one colour, or none", () => {
    for (const s of STYLES) {
      const expected = BLACK_AND_WHITE.includes(s.id) ? "black-and-white" : ONE_COLOUR.includes(s.id) ? "one-colour" : undefined
      expect(getStyleTones(s.id), s.id).toBe(expected)
    }
  })

  it("an unknown id has no medium and no tones", () => {
    expect(getStyleMedium("no-such-style")).toBeUndefined()
    expect(getStyleMedium(undefined)).toBeUndefined()
    expect(getStyleTones("no-such-style")).toBeUndefined()
  })
})

describe("media", () => {
  it("the video-only styles are rendered 3D looks, offered for video alone", () => {
    const videoOnly = STYLES.filter((s) => s.media !== undefined)
    expect(videoOnly.map((s) => s.id)).toEqual(VIDEO_ONLY)
    for (const s of videoOnly) {
      expect(s.media, s.id).toEqual(["video"])
      expect(getStyleMedium(s.id), s.id).toBe("3d")
      expect(styleOffersMedia(s, "video"), s.id).toBe(true)
      expect(styleOffersMedia(s, "image"), s.id).toBe(false)
    }
  })

  it("an image list leaves out the video-only styles; a video list has every style, in catalog order", () => {
    expect(stylesForMedia(STYLES, "image").map((s) => s.id)).toEqual(both.map((s) => s.id))
    expect(stylesForMedia(STYLES, "video").map((s) => s.id)).toEqual(STYLES.map((s) => s.id))
  })

  it("a style with no media is offered for both", () => {
    expect(styleOffersMedia({}, "image")).toBe(true)
    expect(styleOffersMedia({}, "video")).toBe(true)
  })
})

describe("restyle", () => {
  it("exactly the styles that do not hold up as a restyle say so", () => {
    expect(STYLES.filter((s) => !styleOffersRestyle(s)).map((s) => s.id)).toEqual(NOT_FOR_RESTYLE)
    for (const id of NOT_FOR_RESTYLE) expect(STYLES.find((s) => s.id === id)!.restyle, id).toBe(false)
  })

  it("a restyle list is the video list without them, in catalog order", () => {
    expect(stylesForRestyle(STYLES).map((s) => s.id)).toEqual(STYLES.filter((s) => !NOT_FOR_RESTYLE.includes(s.id)).map((s) => s.id))
  })

  it("video generation still offers them", () => {
    for (const id of NOT_FOR_RESTYLE) expect(stylesForMedia(STYLES, "video").some((s) => s.id === id), id).toBe(true)
  })

  it("a style that says nothing is offered for restyle", () => {
    expect(styleOffersRestyle({})).toBe(true)
  })
})

describe("the style catalog", () => {
  const catalog = () => getPickerCatalog("style")!

  it("carries media on the video-only options only", () => {
    for (const o of catalog().options!) {
      expect(o.media, o.id).toEqual(VIDEO_ONLY.includes(o.id) ? ["video"] : undefined)
    }
  })

  it("the wire carries media at both detail levels", () => {
    for (const detail of ["compact", "full"] as const) {
      const options = projectPickerCatalog(catalog(), { detail }).options!
      const felt = options.find((o) => o.id === "felt-puppet")!
      expect(felt.media, detail).toEqual(["video"])
      expect(options.find((o) => o.id === "anime")!.media, detail).toBeUndefined()
    }
  })

  it("the catalog and the wire carry restyle: false on exactly those options, at both detail levels", () => {
    for (const o of catalog().options!) expect(o.restyle, o.id).toBe(NOT_FOR_RESTYLE.includes(o.id) ? false : undefined)
    for (const detail of ["compact", "full"] as const) {
      const options = projectPickerCatalog(catalog(), { detail }).options!
      expect(options.find((o) => o.id === "fantasy")!.restyle, detail).toBe(false)
      expect(options.find((o) => o.id === "vaporwave")!.restyle, detail).toBeUndefined()
    }
  })

  it("a catalog pack that removes a video-only style takes away its medium too", () => {
    registerCatalogPack({ id: "t-deny", catalogId: "style", mode: "deny", denyIds: ["felt-puppet"] })
    expect(getStyleMedium("felt-puppet")).toBeUndefined()
    expect(getPickerCatalog("style")!.options!.some((o) => o.id === "felt-puppet")).toBe(false)
  })
})

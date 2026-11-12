/**
 * registerPickerPictures — a deployment's own picture for a picker option
 * (`catalogs.images: "own"`), registered at its composition root (a deployment
 * overlay's register()). The registry ships no content: with nothing
 * registered, every catalog reply is what it was before the seam existed.
 *
 * What it refuses at registration, registering none of the call's entries
 * (the overlay loader turns the throw into a refused boot, as it does for a
 * preset pack): a malformed entry, an unknown key, an address that is not an
 * https address on this install's media host, a clip where a picture belongs,
 * and an option registered twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const env = vi.hoisted(() => ({ publicUrl: "https://media.example.com", fallback: "" }))

vi.mock("../config.js", () => ({
  config: {
    get R2_PUBLIC_URL() {
      return env.publicUrl
    },
    get R2_PUBLIC_FALLBACK_DOMAIN() {
      return env.fallback
    },
  },
}))

import {
  getRegisteredPickerPictures,
  hasRegisteredPickerPictures,
  registerPickerPictures,
  registeredPickerPicture,
  resetPickerPicturesForTests,
  type PickerPictureEntry,
} from "../picker-pictures.js"

const PICTURE = "https://media.example.com/pictures/style/film-noir.webp"
const LARGE = "https://media.example.com/pictures/style/film-noir.large.webp"

function entry(overrides: Partial<Record<keyof PickerPictureEntry, unknown>> & Record<string, unknown> = {}): PickerPictureEntry {
  return { catalogId: "style", optionId: "film-noir", pictureUrl: PICTURE, ...overrides } as PickerPictureEntry
}

beforeEach(() => {
  env.publicUrl = "https://media.example.com"
  env.fallback = ""
})
afterEach(() => resetPickerPicturesForTests())

describe("nothing registered", () => {
  it("holds nothing: the platform ships no picture of its own here", () => {
    expect(getRegisteredPickerPictures()).toEqual([])
    expect(hasRegisteredPickerPictures()).toBe(false)
    expect(registeredPickerPicture("style", "film-noir")).toBeUndefined()
  })
})

describe("registering", () => {
  it("keeps each entry, looked up by catalog and option", () => {
    registerPickerPictures([entry({ enlargedPictureUrl: LARGE }), entry({ catalogId: "person", optionId: "man", pictureUrl: "https://media.example.com/p/man.jpg" })])
    expect(hasRegisteredPickerPictures()).toBe(true)
    expect(registeredPickerPicture("style", "film-noir")).toEqual({ catalogId: "style", optionId: "film-noir", pictureUrl: PICTURE, enlargedPictureUrl: LARGE })
    expect(registeredPickerPicture("person", "man")?.pictureUrl).toBe("https://media.example.com/p/man.jpg")
    expect(registeredPickerPicture("person", "film-noir")).toBeUndefined()
    expect(getRegisteredPickerPictures()).toHaveLength(2)
  })

  it("the enlarged picture is optional", () => {
    registerPickerPictures([entry()])
    expect(registeredPickerPicture("style", "film-noir")).toEqual({ catalogId: "style", optionId: "film-noir", pictureUrl: PICTURE })
  })

  it("several calls add up", () => {
    registerPickerPictures([entry()])
    registerPickerPictures([entry({ optionId: "anime", pictureUrl: "https://media.example.com/a.webp" })])
    expect(getRegisteredPickerPictures().map((e) => e.optionId)).toEqual(["film-noir", "anime"])
  })

  it("stores a copy: what was checked is what is served", () => {
    const mine = { ...entry() }
    registerPickerPictures([mine])
    mine.pictureUrl = "https://elsewhere.example.org/x.webp"
    expect(registeredPickerPicture("style", "film-noir")?.pictureUrl).toBe(PICTURE)
  })

  it("accepts the install's media host whatever the path, and its fallback domain", () => {
    env.publicUrl = "https://media.example.com/bucket"
    env.fallback = "pub-123.r2.dev"
    registerPickerPictures([
      entry({ pictureUrl: "https://media.example.com/other/path.png?v=2" }),
      entry({ optionId: "anime", pictureUrl: "https://pub-123.r2.dev/a.webp", enlargedPictureUrl: "https://media.example.com/a-large.webp" }),
    ])
    expect(getRegisteredPickerPictures()).toHaveLength(2)
  })
})

describe("refused at registration", () => {
  const refuses = (entries: unknown, message: RegExp) => {
    expect(() => registerPickerPictures(entries as PickerPictureEntry[])).toThrow(message)
    expect(getRegisteredPickerPictures()).toEqual([])
  }

  it("a list that is not an array", () => refuses({ catalogId: "style" }, /must be an array/))

  it("an entry that is not an object", () => {
    refuses([null], /entry 1 is not an object/)
    refuses(["https://media.example.com/a.webp"], /entry 1 is not an object/)
  })

  it("a missing or blank catalog or option id", () => {
    refuses([entry({ catalogId: "" })], /catalogId must be a non-empty string/)
    refuses([entry({ catalogId: " style" })], /catalogId must be a non-empty string/)
    refuses([entry({ optionId: undefined })], /optionId must be a non-empty string/)
    refuses([entry({ optionId: 7 })], /optionId must be a non-empty string/)
  })

  it("a key an entry does not carry (a typo must not pass silently)", () => {
    refuses([entry({ enlargedPicture: LARGE })], /unknown key "enlargedPicture"/)
    refuses([entry({ clipUrl: "https://media.example.com/a.mp4" })], /unknown key "clipUrl"/)
  })

  it("no picture address", () => refuses([entry({ pictureUrl: undefined })], /pictureUrl must be an https address on this install's media host/))

  it("an address that is not a URL, or not https", () => {
    refuses([entry({ pictureUrl: "pictures/a.webp" })], /pictureUrl .* is not an https address on this install's media host/)
    refuses([entry({ pictureUrl: "http://media.example.com/a.webp" })], /pictureUrl .* is not an https address on this install's media host/)
  })

  it("an address on any other host", () => {
    refuses([entry({ pictureUrl: "https://cdn.nodaro.ai/picker-renders/a.webp" })], /pictureUrl .*cdn\.nodaro\.ai.* is not an https address on this install's media host \(https:\/\/media\.example\.com\)/)
    refuses([entry({ pictureUrl: "https://media.example.com.evil.org/a.webp" })], /not an https address on this install's media host/)
    refuses([entry({ pictureUrl: "https://user@evil.org/a.webp" })], /not an https address on this install's media host/)
    refuses([entry({ enlargedPictureUrl: "https://elsewhere.example.org/a.webp" })], /enlargedPictureUrl .* is not an https address on this install's media host/)
  })

  it("every address when the install has no media host configured", () => {
    env.publicUrl = ""
    refuses([entry()], /this install has no media host \(R2_PUBLIC_URL\)/)
  })

  it("a clip where a picture belongs (clips are not part of an entry yet)", () => {
    refuses([entry({ pictureUrl: "https://media.example.com/a.mp4" })], /pictureUrl .* is a clip, not a picture/)
    refuses([entry({ enlargedPictureUrl: "https://media.example.com/a.webm?x=1" })], /enlargedPictureUrl .* is a clip, not a picture/)
  })

  it("an option registered twice, in one call or across calls", () => {
    refuses([entry(), entry({ pictureUrl: "https://media.example.com/b.webp" })], /"style\/film-noir" is registered twice/)
    registerPickerPictures([entry()])
    expect(() => registerPickerPictures([entry({ pictureUrl: "https://media.example.com/b.webp" })])).toThrow(/"style\/film-noir" is already registered/)
    expect(getRegisteredPickerPictures()).toHaveLength(1)
  })

  it("names every problem of the call in one message, and registers none of it", () => {
    const err = (() => {
      try {
        registerPickerPictures([entry({ optionId: "" }), entry({ optionId: "ok" }), entry({ optionId: "x", pictureUrl: "https://evil.org/a.png" })])
      } catch (e) {
        return (e as Error).message
      }
      return ""
    })()
    expect(err).toMatch(/entry 1: optionId/)
    expect(err).toMatch(/entry 3 .*evil\.org/)
    expect(getRegisteredPickerPictures()).toEqual([])
  })
})

/**
 * The gallery moderation funnel and the parsers of its two stored lists.
 * Neutral stand-in words on purpose: the real list is admin data, never code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const settings = vi.hoisted(() => ({
  current: { gallery_blocked_words: [] as unknown[], gallery_banned_users: [] as unknown[] },
  /** The stand-in defaults the reader hands out when the settings could not be read. */
  failed: { gallery_blocked_words: [] as unknown[], gallery_banned_users: [] as unknown[] },
}))
const profiles = vi.hoisted(() => ({ rows: [] as Array<{ id: string; email: string }>, calls: 0 }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      let pattern = ""
      const builder: Record<string, unknown> = {
        select: () => builder,
        ilike: (_c: string, p: string) => {
          pattern = p
          return builder
        },
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          profiles.calls++
          // ILIKE: % is any run; \x is x itself.
          const source = pattern.replace(/\\(.)|(%)|([^\\%]+)/g, (_m, escaped?: string, any?: string, text?: string) =>
            (escaped ?? text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") || (any ? ".*" : ""),
          )
          const re = new RegExp(`^${source}$`, "i")
          return resolve({ data: profiles.rows.filter((r) => re.test(r.email)).map((r) => ({ id: r.id })), error: null })
        },
      }
      return builder
    },
  },
}))
vi.mock("../app-settings.js", () => ({
  getAppSettings: vi.fn(async () => settings.current),
  settingsReadFailed: (value: unknown) => value === settings.failed,
}))

import {
  MAX_QUERY_EXCLUDED_USERS,
  OWNER_VIEW_MODERATION,
  bannedGalleryUsersFilter,
  buildGalleryModeration,
  galleryHides,
  galleryTextOf,
  loadGalleryModeration,
} from "../gallery-moderation.js"
import { cleanEmailPattern, emailPatternToIlike, parseGalleryBannedUsers, parseGalleryWordEntries, GALLERY_MODERATION_LIMITS } from "../gallery-moderation-settings.js"

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const word = (w: string, translations: string[] = [], exceptions: string[] = []) => ({ word: w, translations, exceptions })

describe("galleryTextOf", () => {
  it("reads every text of the input, nested ones too", () => {
    const text = galleryTextOf({ prompt: "first", lyrics: "second", lines: [{ text: "third" }] })
    expect(text.split("\n")).toEqual(["first", "second", "third"])
  })

  it("never reads a negative prompt, a link or an id", () => {
    const text = galleryTextOf({
      prompt: "kept",
      negativePrompt: "bucket",
      negative_prompt: "bucket",
      imageUrl: "https://example.com/bucket.png",
      reference: "data:image/png;base64,AAAA",
      jobId: A,
    })
    expect(text).toBe("kept")
  })

  it("reads the prompts an output carries, and nothing else of it", () => {
    const text = galleryTextOf({ prompt: "asked" }, { revisedPrompt: "rewritten", caption: "not read", imageUrl: "https://x/y.png" })
    expect(text.split("\n")).toEqual(["asked", "rewritten"])
  })

  it("reads the shown prompt first and whole, however long the other fields are", () => {
    const text = galleryTextOf({ lyrics: "la ".repeat(15_000), prompt: `${"x".repeat(25_000)} bucket` })
    expect(text.startsWith("x")).toBe(true)
    expect(text).toContain("bucket")
  })

  it("never reads the same text twice", () => {
    expect(galleryTextOf({ prompt: "same", title: "same" })).toBe("same")
  })

  it("tolerates anything that is not an object", () => {
    expect(galleryTextOf(null)).toBe("")
    expect(galleryTextOf("plain")).toBe("plain")
  })
})

describe("galleryHides", () => {
  const moderation = buildGalleryModeration([word("bucket", ["seau"], ["bucket of water"])], [{ userId: A, addedAt: null }])

  it("hides every output of a blocked creator", () => {
    expect(galleryHides(moderation, { userId: A, inputData: { prompt: "a sunset" } })).toBe(true)
    expect(galleryHides(moderation, { userId: A.toUpperCase(), inputData: { prompt: "a sunset" } })).toBe(true)
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a sunset" } })).toBe(false)
  })

  it("hides an output made from a banned word in any of its texts, in any of its languages", () => {
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a red bucket" } })).toBe(true)
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "song", lyrics: "un seau" } })).toBe(true)
  })

  it("keeps an exception phrase and a negative prompt", () => {
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a bucket of water" } })).toBe(false)
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a sunset", negativePrompt: "bucket" } })).toBe(false)
  })

  it("the owner view applies none of the admin's lists", () => {
    expect(galleryHides(OWNER_VIEW_MODERATION, { userId: A, inputData: { prompt: "a red bucket" } })).toBe(false)
  })

  it("the built-in list applies everywhere, the owner view included", () => {
    expect(galleryHides(OWNER_VIEW_MODERATION, { userId: B, inputData: { prompt: "nsfw scene" } })).toBe(true)
  })
})

describe("bannedGalleryUsersFilter", () => {
  it("is null when nobody is blocked", () => {
    expect(bannedGalleryUsersFilter(OWNER_VIEW_MODERATION)).toBeNull()
  })

  it("lists the blocked creators for the query, capped", () => {
    expect(bannedGalleryUsersFilter(buildGalleryModeration([], [{ userId: A, addedAt: null }, { userId: B, addedAt: null }]))).toBe(`(${A},${B})`)
    const many = Array.from({ length: MAX_QUERY_EXCLUDED_USERS + 5 }, (_, i) => ({
      userId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      addedAt: null,
    }))
    const filter = bannedGalleryUsersFilter(buildGalleryModeration([], many))!
    expect(filter.split(",")).toHaveLength(MAX_QUERY_EXCLUDED_USERS)
  })
})

describe("loadGalleryModeration", () => {
  beforeEach(() => {
    settings.current = { gallery_blocked_words: [], gallery_banned_users: [] }
  })

  it("compiles the stored lists, once per settings refresh", async () => {
    settings.current = { gallery_blocked_words: [word("bucket")], gallery_banned_users: [{ userId: A, addedAt: null }] }
    const first = await loadGalleryModeration()
    expect(first.bannedUserIds.has(A)).toBe(true)
    expect(galleryHides(first, { userId: B, inputData: { prompt: "bucket" } })).toBe(true)
    expect(await loadGalleryModeration()).toBe(first)

    settings.current = { gallery_blocked_words: [], gallery_banned_users: [] }
    const second = await loadGalleryModeration()
    expect(second).not.toBe(first)
    expect(galleryHides(second, { userId: A, inputData: { prompt: "bucket" } })).toBe(false)
  })

  it("keeps the last rules read when the settings cannot be read — never an unmoderated gallery", async () => {
    settings.current = { gallery_blocked_words: [word("bucket")], gallery_banned_users: [{ userId: A, addedAt: null }] }
    const good = await loadGalleryModeration()

    settings.current = settings.failed
    const during = await loadGalleryModeration()

    expect(during).toBe(good)
    expect(galleryHides(during, { userId: A, inputData: { prompt: "a sunset" } })).toBe(true)
  })
})

describe("suggested exceptions", () => {
  it("are kept apart from the approved ones and never apply", () => {
    const [entry] = parseGalleryWordEntries([
      { word: "bucket", translations: [], exceptions: ["a bucket of water"], suggestedExceptions: ["a bucket of sand", "a bucket of water", 3] },
    ])
    expect(entry).toEqual({ word: "bucket", translations: [], exceptions: ["a bucket of water"], suggestedExceptions: ["a bucket of sand"] })
    const moderation = buildGalleryModeration([entry!], [])
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a bucket of sand" } })).toBe(true)
    expect(galleryHides(moderation, { userId: B, inputData: { prompt: "a bucket of water" } })).toBe(false)
  })
})

describe("the stored lists' parsers", () => {
  it("keep the well-formed words, trimmed, and drop the rest", () => {
    expect(
      parseGalleryWordEntries([
        word(" bucket ", [" seau ", "", "seau", 7 as unknown as string], ["  bucket of water "]),
        word("bucket"),
        { word: "" },
        { nope: true },
        "bucket",
        null,
      ]),
    ).toEqual([word("bucket", ["seau"], ["bucket of water"])])
    expect(parseGalleryWordEntries({ not: "a list" })).toEqual([])
  })

  it("cap a word's length and the list's size", () => {
    expect(parseGalleryWordEntries([word("x".repeat(GALLERY_MODERATION_LIMITS.termLength + 1))])).toEqual([])
    const lots = Array.from({ length: GALLERY_MODERATION_LIMITS.words + 3 }, (_, i) => word(`w${i}`))
    expect(parseGalleryWordEntries(lots)).toHaveLength(GALLERY_MODERATION_LIMITS.words)
  })

  it("keep the blocked creators with a real id, once each", () => {
    expect(
      parseGalleryBannedUsers([{ userId: A, addedAt: "2026-10-04T00:00:00.000Z" }, A.toUpperCase(), { userId: "not-an-id" }, { userId: B }, 5]),
    ).toEqual([
      { userId: A, addedAt: "2026-10-04T00:00:00.000Z" },
      { userId: B, addedAt: null },
    ])
    expect(parseGalleryBannedUsers("nope")).toEqual([])
  })
})

describe("blocked email patterns", () => {
  it("keep only patterns that name someone, never everyone", () => {
    expect(cleanEmailPattern(" SeriesName**@Example.com ")).toBe("seriesname*@example.com")
    for (const bad of ["*", "*@gmail.com", "ab*@x.com", "a b*@x.com", "x".repeat(130)]) expect(cleanEmailPattern(bad)).toBeNull()
  })

  it("read * as anything and % or _ as themselves", () => {
    expect(emailPatternToIlike("series_name*@example.com")).toBe("series\\_name%@example.com")
  })

  it("block every account the pattern matches — and one made after it", async () => {
    const C = "00000000-0000-4000-8000-00000000000c"
    profiles.rows = [{ id: A, email: "seriesname28@example.com" }, { id: B, email: "someone@example.com" }]
    settings.current = { gallery_blocked_words: [], gallery_banned_users: [], gallery_banned_email_patterns: [{ pattern: "seriesname*@example.com", addedAt: null }] } as never
    const first = await loadGalleryModeration()
    expect([...first.bannedUserIds]).toEqual([A])

    // A new account under the pattern, found once the minute is up.
    profiles.rows = [...profiles.rows, { id: C, email: "seriesname30@example.com" }]
    vi.useFakeTimers({ now: Date.now() + 61_000 })
    try {
      expect([...(await loadGalleryModeration()).bannedUserIds].sort()).toEqual([A, C].sort())
    } finally {
      vi.useRealTimers()
    }
  })
})

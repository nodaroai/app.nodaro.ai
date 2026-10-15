/**
 * A user preset keeps its OWN copy of its example picture
 * (lib/presets/preview-copy.ts): the address a caller names is one of their
 * uploads or results, whose life is its own — a library delete or a retention
 * sweep would otherwise leave the preset showing a broken picture. The copy is
 * content-named under `node-presets/<userId>/`, and released once no preset of
 * the user names it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  copied: [] as Array<{ from: string; to: string; userId: string }>,
  existing: new Set<string>(),
  named: [] as string[],
  lookupError: null as null | { message: string },
  deleted: [] as Array<{ keys: string[]; source: string }>,
  failed: [] as string[],
  foreignKeys: new Set<string>(),
  usage: [] as Array<{ userId: string; bytes: number }>,
}))

vi.mock("../../storage.js", () => ({
  r2Url: (key: string) => `https://cdn.example.test/${key}`,
  headR2Object: async (key: string) => ({ exists: h.existing.has(key) }),
  getR2ObjectSize: async () => 1000,
  copyOwnObjectToKey: async (from: string, to: string, userId: string) => {
    h.copied.push({ from, to, userId })
    return `https://cdn.example.test/${to}`
  },
}))

vi.mock("../preview-url.js", () => ({
  previewStorageKey: (url: string) =>
    url.startsWith("https://cdn.example.test/") ? url.slice("https://cdn.example.test/".length) : null,
}))

vi.mock("../../storage-delete.js", () => ({
  deleteKeysRecordingFailures: async (keys: string[], source: string) => {
    h.deleted.push({ keys, source })
    return { failed: keys.filter((k) => h.failed.includes(k)) }
  },
}))

vi.mock("../../key-ownership.js", () => ({
  ownKeysOnly: async (_userId: string, keys: string[]) => keys.filter((k) => !h.foreignKeys.has(k)),
}))

vi.mock("../../../utils/file-validation.js", () => ({
  updateStorageUsage: async (userId: string, bytes: number) => {
    h.usage.push({ userId, bytes })
  },
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        in: (_col: string, values: string[]) =>
          Promise.resolve(
            h.lookupError
              ? { data: null, error: h.lookupError }
              : { data: values.filter((v) => h.named.includes(v)).map((v) => ({ preview_url: v })), error: null },
          ),
      }
      return q
    },
  },
}))

const { storePresetPreviews, releasePresetPreviews } = await import("../preview-copy.js")
const { presetPreviewKey } = await import("../preview-key.js")

const ME = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const cdn = (key: string) => `https://cdn.example.test/${key}`

beforeEach(() => {
  h.copied = []
  h.existing = new Set()
  h.named = []
  h.lookupError = null
  h.deleted = []
  h.failed = []
  h.foreignKeys = new Set()
  h.usage = []
})

describe("presetPreviewKey", () => {
  it("is content-named under the user's folder, keeping the extension", () => {
    const key = presetPreviewKey(ME, "images/job-1.webp")
    expect(key).toMatch(new RegExp(`^node-presets/${ME}/preview-[0-9a-f]{16}\\.webp$`))
    expect(presetPreviewKey(ME, "images/job-1.webp")).toBe(key)
    expect(presetPreviewKey(ME, "images/job-2.webp")).not.toBe(key)
    expect(presetPreviewKey(OTHER, "images/job-1.webp")).not.toBe(key)
  })
})

describe("storePresetPreviews", () => {
  it("copies each source into the user's folder once and returns the copy's address", async () => {
    const stored = await storePresetPreviews(ME, ["images/job-1.png", "images/job-1.png", "uploads/images/a.jpg"])
    expect(h.copied).toEqual([
      { from: "images/job-1.png", to: presetPreviewKey(ME, "images/job-1.png"), userId: ME },
      { from: "uploads/images/a.jpg", to: presetPreviewKey(ME, "uploads/images/a.jpg"), userId: ME },
    ])
    expect(stored.get("images/job-1.png")).toBe(cdn(presetPreviewKey(ME, "images/job-1.png")))
  })

  it("reuses a copy that already exists", async () => {
    h.existing.add(presetPreviewKey(ME, "images/job-1.png"))
    const stored = await storePresetPreviews(ME, ["images/job-1.png"])
    expect(h.copied).toEqual([])
    expect(stored.get("images/job-1.png")).toBe(cdn(presetPreviewKey(ME, "images/job-1.png")))
  })

  it("keeps the user's own preset picture as it is (no copy of a copy)", async () => {
    const own = presetPreviewKey(ME, "images/job-1.png")
    const stored = await storePresetPreviews(ME, [own])
    expect(h.copied).toEqual([])
    expect(stored.get(own)).toBe(cdn(own))
  })
})

describe("releasePresetPreviews", () => {
  const mine = (src: string) => cdn(presetPreviewKey(ME, src))

  it("deletes a copy no preset names any more and gives its bytes back", async () => {
    await releasePresetPreviews(ME, [mine("images/a.png")])
    expect(h.deleted).toEqual([{ keys: [presetPreviewKey(ME, "images/a.png")], source: "preset-preview" }])
    expect(h.usage).toEqual([{ userId: ME, bytes: -1000 }])
  })

  it("keeps a copy another preset of the user still names", async () => {
    h.named = [mine("images/a.png")]
    await releasePresetPreviews(ME, [mine("images/a.png")])
    expect(h.deleted).toEqual([])
  })

  it("never touches anything outside the user's own preset folder", async () => {
    await releasePresetPreviews(ME, [
      cdn("images/job-1.png"),
      cdn(presetPreviewKey(OTHER, "images/a.png")),
      "https://elsewhere.example.com/node-presets/x.png",
      null,
      undefined,
    ])
    expect(h.deleted).toEqual([])
  })

  it("keeps a copy another user has a claim on (saved to their library)", async () => {
    h.foreignKeys.add(presetPreviewKey(ME, "images/a.png"))
    await releasePresetPreviews(ME, [mine("images/a.png")])
    expect(h.deleted).toEqual([])
  })

  it("gives back only the bytes of copies storage confirmed gone", async () => {
    h.failed = [presetPreviewKey(ME, "images/b.png")]
    await releasePresetPreviews(ME, [mine("images/a.png"), mine("images/b.png")])
    expect(h.usage).toEqual([{ userId: ME, bytes: -1000 }])
  })

  it("never throws: a failed lookup keeps every copy", async () => {
    h.lookupError = { message: "down" }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(releasePresetPreviews(ME, [mine("images/a.png")])).resolves.toBeUndefined()
    expect(h.deleted).toEqual([])
    errors.mockRestore()
  })
})

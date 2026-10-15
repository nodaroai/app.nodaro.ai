/**
 * A user preset's `previewUrl` must be an image this platform stores — an
 * upload or a generated result OF THE CALLER'S — and must already exist: the
 * CDN keeps a 404 for a long time, so a preset that names a file before its
 * job finishes would show a broken picture to everyone who loads it, long
 * after the file lands. The check asks the storage itself (HEAD, never through
 * the CDN), and only once the file is known not to be another user's
 * (lib/key-ownership.ts): asking first would tell a caller whether someone
 * else's file exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.hoisted(() => {
  process.env.R2_PUBLIC_URL = "https://cdn.example.test"
  process.env.R2_PUBLIC_FALLBACK_DOMAIN = "pub-123.r2.example.test"
  process.env.R2_ACCESS_KEY_ID = "test-access-key"
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key"
  process.env.R2_ACCOUNT_ID = "test-account"
})

const head = vi.hoisted(() => ({ fn: vi.fn() }))
const foreign = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock("../../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage.js")>()),
  headR2Object: (key: string) => head.fn(key),
}))

vi.mock("../../key-ownership.js", () => ({
  foreignStorageUrls: (userId: string, urls: readonly string[]) => foreign.fn(userId, urls),
}))

const { checkPresetPreviewUrl, previewUrlProblem, previewStorageKey } = await import("../preview-url.js")

const ME = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  head.fn.mockReset()
  head.fn.mockResolvedValue({ exists: true })
  foreign.fn.mockReset()
  foreign.fn.mockResolvedValue(new Set())
})

describe("checkPresetPreviewUrl", () => {
  it("accepts an existing image on the platform's CDN, checking the storage key itself", async () => {
    expect(await checkPresetPreviewUrl(ME, "https://cdn.example.test/images/job-1.png")).toBe("ok")
    expect(head.fn).toHaveBeenCalledWith("images/job-1.png")
    expect(foreign.fn).toHaveBeenCalledWith(ME, ["https://cdn.example.test/images/job-1.png"])
  })

  it("accepts the platform's second public host", async () => {
    expect(await checkPresetPreviewUrl(ME, "https://pub-123.r2.example.test/uploads/u1/a.webp")).toBe("ok")
    expect(head.fn).toHaveBeenCalledWith("uploads/u1/a.webp")
  })

  it("refuses an image that does not exist yet", async () => {
    head.fn.mockResolvedValue({ exists: false })
    expect(await checkPresetPreviewUrl(ME, "https://cdn.example.test/images/job-2.png")).toBe("missing")
  })

  it("refuses another user's file WITHOUT asking the storage whether it exists", async () => {
    const url = "https://cdn.example.test/images/their-job.png"
    foreign.fn.mockResolvedValue(new Set([url]))
    expect(await checkPresetPreviewUrl(ME, url)).toBe("not_yours")
    expect(head.fn).not.toHaveBeenCalled()
  })

  it("accepts the caller's own preset picture, and refuses another user's, by its folder alone", async () => {
    expect(await checkPresetPreviewUrl(ME, `https://cdn.example.test/node-presets/${ME}/preview-abc.png`)).toBe("ok")
    expect(await checkPresetPreviewUrl(ME, `https://cdn.example.test/node-presets/${OTHER}/preview-abc.png`)).toBe("not_yours")
    expect(head.fn).toHaveBeenCalledTimes(1)
    expect(foreign.fn).not.toHaveBeenCalled()
  })

  it.each([
    "https://elsewhere.example.com/images/job-1.png",
    "http://cdn.example.test/images/job-1.png",
    "https://cdn.example.test.evil.example/images/job-1.png",
    "https://cdn.example.test/videos/job-1.mp4",
    "https://cdn.example.test/audio/job-1.mp3",
    "https://cdn.example.test/",
    "not a url",
  ])("refuses %s without asking the storage", async (url) => {
    expect(await checkPresetPreviewUrl(ME, url)).toBe("not_platform_image")
    expect(head.fn).not.toHaveBeenCalled()
  })

  it("passes a storage or ownership error on, rather than calling the file missing", async () => {
    head.fn.mockRejectedValue(new Error("network"))
    await expect(checkPresetPreviewUrl(ME, "https://cdn.example.test/images/job-3.png")).rejects.toThrow("network")
    foreign.fn.mockRejectedValue(new Error("lookup"))
    await expect(checkPresetPreviewUrl(ME, "https://cdn.example.test/images/job-4.png")).rejects.toThrow("lookup")
  })
})

describe("previewStorageKey", () => {
  it("reads the key on either public host, and nothing else", () => {
    expect(previewStorageKey("https://cdn.example.test/images/a.png")).toBe("images/a.png")
    expect(previewStorageKey("https://pub-123.r2.example.test/images/a.png")).toBe("images/a.png")
    expect(previewStorageKey("https://elsewhere.example.com/images/a.png")).toBeNull()
  })
})

describe("previewUrlProblem", () => {
  it("is null when every url is fine, and asks once per distinct url", async () => {
    const url = "https://cdn.example.test/images/job-1.png"
    expect(await previewUrlProblem(ME, [{ label: "a", url }, { label: "b", url }])).toBeNull()
    expect(head.fn).toHaveBeenCalledTimes(1)
  })

  it("names the first entry with a problem", async () => {
    head.fn.mockImplementation(async (key: string) => ({ exists: key !== "images/gone.png" }))
    const problem = await previewUrlProblem(ME, [
      { label: "presets[0].previewUrl", url: "https://cdn.example.test/images/ok.png" },
      { label: "presets[1].previewUrl", url: "https://cdn.example.test/images/gone.png" },
    ])
    expect(problem).toMatch(/^presets\[1\]\.previewUrl /)
    expect(problem).toMatch(/does not exist/)
  })

  it("says what an acceptable preview is when the url is foreign", async () => {
    const problem = await previewUrlProblem(ME, [{ label: "previewUrl", url: "https://elsewhere.example.com/x.png" }])
    expect(problem).toMatch(/^previewUrl must be an image stored on this platform/)
  })

  it("says the file is not the caller's when another user made it", async () => {
    const url = "https://cdn.example.test/images/their-job.png"
    foreign.fn.mockResolvedValue(new Set([url]))
    const problem = await previewUrlProblem(ME, [{ label: "previewUrl", url }])
    expect(problem).toMatch(/^previewUrl must be one of your own/)
  })
})

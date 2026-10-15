import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MODEL_MAKERS } from "@nodaro/shared/model-catalog"

/**
 * The address of a maker's mark is published only for a maker the operator
 * declared AND whose file storage holds as an SVG — checked with a HEAD against
 * the bucket, never through the CDN, which keeps a 404 at its edge for a year.
 * A client that fetched an address before its file existed would poison it.
 */
const h = vi.hoisted(() => ({
  config: { R2_PUBLIC_URL: "https://cdn.example.com" },
  declared: [] as string[],
  readFailed: false,
  storageConfigured: true,
  head: vi.fn(),
  getAppSettings: vi.fn(),
}))

vi.mock("../config.js", () => ({ config: h.config }))
vi.mock("../app-settings.js", () => ({
  getAppSettings: h.getAppSettings,
  settingsReadFailed: () => h.readFailed,
}))
vi.mock("../storage.js", () => ({
  headR2Object: h.head,
  isStorageConfigured: () => h.storageConfigured,
  r2Url: (key: string) => `${h.config.R2_PUBLIC_URL}/${key}`,
}))

const { makerLogoUrls, makerLogoObjectKey, MAKER_LOGO_PREFIX, __resetMakerLogoCacheForTests, __settleMakerLogoChecksForTests } =
  await import("../maker-logos.js")
const { keptStoragePrefix } = await import("../kept-storage-prefixes.js")

const ETAG = '"9b2cf535f27731c974343645a3985328"'
const MODIFIED = new Date("2026-10-15T08:00:00Z")
const svg = (etag = ETAG, lastModified = MODIFIED) => ({ exists: true, etag, lastModified, contentType: "image/svg+xml" })
const ADDRESS = /^https:\/\/cdn\.example\.com\/brand\/makers\/google\.svg\?v=[0-9a-f]{16}$/
const T0 = new Date("2026-10-15T00:00:00Z").getTime()

function at(ms: number) {
  vi.setSystemTime(new Date(T0 + ms))
}

beforeEach(() => {
  h.head.mockReset()
  h.getAppSettings.mockReset()
  h.getAppSettings.mockImplementation(async () => ({ model_maker_logos: h.declared }))
  h.declared = []
  h.readFailed = false
  h.config.R2_PUBLIC_URL = "https://cdn.example.com"
  h.storageConfigured = true
  __resetMakerLogoCacheForTests()
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
  at(0)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the maker-mark convention", () => {
  it("is one SVG per maker id under brand/makers/", () => {
    expect(MAKER_LOGO_PREFIX).toBe("brand/makers/")
    expect(makerLogoObjectKey("google")).toBe("brand/makers/google.svg")
    expect(makerLogoObjectKey("black-forest-labs")).toBe("brand/makers/black-forest-labs.svg")
  })

  it("puts every maker's mark under a prefix storage never deletes", () => {
    const unkept = Object.keys(MODEL_MAKERS).filter((id) => !keptStoragePrefix(makerLogoObjectKey(id as never)))
    expect(unkept).toEqual([])
  })
})

describe("makerLogoUrls — what is published", () => {
  it("publishes nothing, and asks storage nothing, while no maker is declared", async () => {
    expect((await makerLogoUrls()).size).toBe(0)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("publishes a declared SVG the bucket holds at the convention address, with its version", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValue(svg())
    const urls = await makerLogoUrls()
    expect(urls.get("google")).toMatch(ADDRESS)
    expect(h.head).toHaveBeenCalledTimes(1)
    expect(h.head).toHaveBeenCalledWith("brand/makers/google.svg", { abortSignal: expect.any(AbortSignal) })
  })

  it("never publishes a declared mark the bucket does not hold", async () => {
    h.declared = ["google", "openai"]
    h.head.mockImplementation(async (key: string) => (key.endsWith("/google.svg") ? svg() : { exists: false }))
    expect([...(await makerLogoUrls()).keys()]).toEqual(["google"])
  })

  it("never publishes a file stored as anything but image/svg+xml, and says why", async () => {
    h.declared = ["google", "openai", "xai"]
    h.head.mockImplementation(async (key: string) => {
      if (key.endsWith("/google.svg")) return { ...svg(), contentType: "application/octet-stream" }
      if (key.endsWith("/openai.svg")) return { ...svg(), contentType: "image/svg+xml; charset=utf-8" }
      return { ...svg(), contentType: undefined }
    })
    expect([...(await makerLogoUrls()).keys()]).toEqual(["openai"])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("brand/makers/google.svg"))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("brand/makers/xai.svg"))
  })

  it("publishes nothing for a maker whose first check failed (an outage, a timeout) — never a guess", async () => {
    h.declared = ["google", "openai"]
    h.head.mockImplementation(async (key: string) => {
      if (key.endsWith("/openai.svg")) throw new Error("The operation was aborted due to timeout")
      return svg()
    })
    const urls = await makerLogoUrls()
    expect(urls.has("openai")).toBe(false)
    expect(urls.get("google")).toMatch(ADDRESS)
  })

  it("publishes nothing, and asks storage nothing, without a public media base or configured storage", async () => {
    h.declared = ["google"]
    h.config.R2_PUBLIC_URL = ""
    expect((await makerLogoUrls()).size).toBe(0)
    h.config.R2_PUBLIC_URL = "https://cdn.example.com"
    h.storageConfigured = false
    expect((await makerLogoUrls()).size).toBe(0)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("withdraws a maker at once when it leaves the declaration", async () => {
    h.declared = ["google", "openai"]
    h.head.mockResolvedValue(svg())
    expect((await makerLogoUrls()).size).toBe(2)
    h.declared = ["openai"]
    expect([...(await makerLogoUrls()).keys()]).toEqual(["openai"])
  })
})

describe("makerLogoUrls — the version on the address", () => {
  async function addressAfterRecheck(next: ReturnType<typeof svg>): Promise<[string, string]> {
    h.declared = ["google"]
    h.head.mockResolvedValueOnce(svg()).mockResolvedValueOnce(next)
    const before = (await makerLogoUrls()).get("google")!
    at(5 * 60_000 + 1)
    await makerLogoUrls()
    await __settleMakerLogoChecksForTests()
    return [before, (await makerLogoUrls()).get("google")!]
  }

  it("stays the same while the file does", async () => {
    const [before, after] = await addressAfterRecheck(svg())
    expect(after).toBe(before)
  })

  it("changes when the same bytes are uploaded again — a 404 cached for the old address cannot follow it", async () => {
    const [before, after] = await addressAfterRecheck(svg(ETAG, new Date("2026-10-16T08:00:00Z")))
    expect(after).not.toBe(before)
    expect(after).toMatch(ADDRESS)
  })

  it("changes when a new file replaces the old one", async () => {
    const [before, after] = await addressAfterRecheck(svg('"0000aaaa"'))
    expect(after).not.toBe(before)
  })

  it("is the plain address when storage reports neither ETag nor LastModified", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValue({ exists: true, contentType: "image/svg+xml" })
    expect((await makerLogoUrls()).get("google")).toBe("https://cdn.example.com/brand/makers/google.svg")
  })
})

describe("makerLogoUrls — what waits on storage", () => {
  it("only an empty cache waits: the first call waits for its checks", async () => {
    h.declared = ["google"]
    let answer: (value: unknown) => void = () => {}
    h.head.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    let settled = false
    const first = makerLogoUrls().then((urls) => {
      settled = true
      return urls
    })
    await vi.waitFor(() => expect(h.head).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    answer(svg())
    expect((await first).get("google")).toMatch(ADDRESS)
  })

  it("an expired check serves the last verified address at once and checks again in the background", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValueOnce(svg())
    const verified = (await makerLogoUrls()).get("google")
    at(5 * 60_000 + 1)
    h.head.mockImplementationOnce(() => new Promise(() => {})) // a store that never answers
    expect((await makerLogoUrls()).get("google")).toBe(verified)
    expect(h.head).toHaveBeenCalledTimes(2)
  })

  it("a background check that finds the file gone withdraws it from the next call", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValueOnce(svg()).mockResolvedValueOnce({ exists: false })
    expect((await makerLogoUrls()).has("google")).toBe(true)
    at(5 * 60_000 + 1)
    expect((await makerLogoUrls()).has("google")).toBe(true)
    await __settleMakerLogoChecksForTests()
    expect((await makerLogoUrls()).has("google")).toBe(false)
  })

  it("a newly declared maker beside verified ones is checked in the background, not waited for", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValue(svg())
    await makerLogoUrls()
    h.declared = ["google", "openai"]
    h.head.mockImplementation(() => new Promise(() => {}))
    expect([...(await makerLogoUrls()).keys()]).toEqual(["google"])
    expect(h.head).toHaveBeenLastCalledWith("brand/makers/openai.svg", expect.anything())
  })

  it("callers that arrive while a maker is being checked share that one check", async () => {
    h.declared = ["google"]
    let answer: (value: unknown) => void = () => {}
    h.head.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const first = makerLogoUrls()
    const second = makerLogoUrls()
    await vi.waitFor(() => expect(h.head).toHaveBeenCalledTimes(1))
    answer(svg())
    const [a, b] = await Promise.all([first, second])
    expect(a.get("google")).toMatch(ADDRESS)
    expect(b.get("google")).toBe(a.get("google"))
    expect(h.head).toHaveBeenCalledTimes(1)
  })
})

describe("makerLogoUrls — a failed check", () => {
  it("keeps the maker's last verified address, and asks again after a minute rather than five", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValueOnce(svg())
    const verified = (await makerLogoUrls()).get("google")
    at(5 * 60_000 + 1)
    h.head.mockRejectedValueOnce(new Error("503 Slow Down"))
    await makerLogoUrls()
    await __settleMakerLogoChecksForTests()
    expect((await makerLogoUrls()).get("google")).toBe(verified) // a thrown HEAD is not a 404
    expect(h.head).toHaveBeenCalledTimes(2)
    at(5 * 60_000 + 59_000)
    await makerLogoUrls()
    expect(h.head).toHaveBeenCalledTimes(2)
    at(5 * 60_000 + 61_000)
    h.head.mockResolvedValueOnce(svg())
    await makerLogoUrls()
    expect(h.head).toHaveBeenCalledTimes(3)
  })

  it("shortens no other maker's check: one failing maker is asked again alone", async () => {
    h.declared = ["google", "openai"]
    h.head.mockImplementation(async (key: string) => {
      if (key.endsWith("/openai.svg")) throw new Error("timeout")
      return svg()
    })
    await makerLogoUrls()
    expect(h.head).toHaveBeenCalledTimes(2)
    at(61_000)
    await makerLogoUrls()
    await __settleMakerLogoChecksForTests()
    expect(h.head).toHaveBeenCalledTimes(3)
    expect(h.head).toHaveBeenLastCalledWith("brand/makers/openai.svg", expect.anything())
  })

  it("a check overtaken by a reset leaves nothing behind (a slow old answer never overwrites a newer state)", async () => {
    h.declared = ["google"]
    let answer: (value: unknown) => void = () => {}
    h.head.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const stale = makerLogoUrls()
    await vi.waitFor(() => expect(h.head).toHaveBeenCalledTimes(1))
    __resetMakerLogoCacheForTests()
    answer(svg())
    await stale
    h.head.mockResolvedValueOnce({ exists: false })
    expect((await makerLogoUrls()).has("google")).toBe(false)
    expect(h.head).toHaveBeenCalledTimes(2)
  })
})

describe("makerLogoUrls — reading the declaration", () => {
  it("never waits long on the settings: a hung read serves the last declaration this process read", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValue(svg())
    expect((await makerLogoUrls()).has("google")).toBe(true)
    h.getAppSettings.mockImplementation(() => new Promise(() => {}))
    const pending = makerLogoUrls()
    await vi.advanceTimersByTimeAsync(1_600)
    expect((await pending).has("google")).toBe(true)
  })

  it("a hung first read serves nothing, without waiting long", async () => {
    h.getAppSettings.mockImplementation(() => new Promise(() => {}))
    const pending = makerLogoUrls()
    await vi.advanceTimersByTimeAsync(1_600)
    expect((await pending).size).toBe(0)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("a failed read (the reader's stand-in defaults) keeps the last declaration rather than hiding the marks", async () => {
    h.declared = ["google"]
    h.head.mockResolvedValue(svg())
    await makerLogoUrls()
    h.readFailed = true
    h.declared = []
    expect((await makerLogoUrls()).has("google")).toBe(true)
  })

  it("never rejects: a read that throws serves the last declaration, or nothing", async () => {
    h.getAppSettings.mockRejectedValueOnce(new Error("connection reset"))
    expect((await makerLogoUrls()).size).toBe(0)
    expect(h.head).not.toHaveBeenCalled()
  })
})

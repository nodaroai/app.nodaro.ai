import { beforeEach, describe, expect, it, vi } from "vitest"
import { MissingProviderKeyError } from "../../provider-keys.js"
import { knownCaptureCode, SITE_CAPTURE_MESSAGES } from "../../../lib/site-capture-codes.js"

const h = vi.hoisted(() => ({
  noKey: false,
  option: "B-prime" as "B" | "B-prime",
  call: vi.fn(),
  abort: vi.fn(async () => ({})),
  listItems: vi.fn(),
  getRecord: vi.fn(),
  listRequests: vi.fn(async () => ({ items: [] as Array<{ errorMessages?: string[] }> })),
  kvDelete: vi.fn(async () => undefined),
  dsDelete: vi.fn(async () => undefined),
  rqDelete: vi.fn(async () => undefined),
  deleteAfter: true,
}))

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>()
  return {
    ...actual,
    getApifyClient: () => {
      if (h.noKey) throw new MissingProviderKeyError("APIFY_API_TOKEN")
      return {
        actor: () => ({ call: h.call }),
        run: () => ({ abort: h.abort }),
        dataset: () => ({ listItems: h.listItems, delete: h.dsDelete }),
        keyValueStore: () => ({ getRecord: h.getRecord, delete: h.kvDelete }),
        requestQueue: () => ({ listRequests: h.listRequests, delete: h.rqDelete }),
      }
    },
  }
})
vi.mock("../site-capture-actor.js", () => ({
  SITE_CAPTURE_ACTOR: {
    get option() {
      return h.option
    },
    get apifyActorId() {
      return h.option === "B" ? "apify/playwright-scraper" : "acjahOC5bWmkdpwxT"
    },
    build: "1.2.3",
    memoryMbytes: 4096,
    runTimeoutSecs: 150,
    waitSecs: 170,
    stillFormat: "png",
    proxyConfiguration: { useApifyProxy: false },
    get deviceInput() {
      return h.option === "B" ? { viewportWidth: 412 } : {}
    },
    get deleteStoragesAfterSuccess() {
      return h.deleteAfter
    },
  },
}))

const { runSiteCapture, buildSiteCaptureInput, SiteCaptureError, CAPTURE_RECORD_MAX_BYTES } = await import("../site-capture.js")
const { ApifyError } = await import("../client.js")

const RUN = { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "ds", defaultKeyValueStoreId: "kv", defaultRequestQueueId: "rq" }
const ITEM = {
  verdict: "ok",
  status: 200,
  finalUrl: "https://example.com/",
  title: "Example",
  lang: "en",
  dir: "ltr",
  device: { width: 412, height: 915, dpr: 2.625 },
  userAgent: "ua",
  coarsePointer: true,
  fullPage: { key: "FULL_PAGE", truncated: false },
  stills: [
    { key: "STILL_0", index: 0, sectionOrder: 0, label: "Ship videos faster", category: "hero" },
    { key: "STILL_1", index: 1, sectionOrder: 1, label: "Make it yours", category: "feature" },
  ],
  sections: [],
  warnings: ["lazy_content_timeout"],
  pageText: "Pro $12 per month",
}
const record = (key: string, bytes = Buffer.from(key)) => ({ key, value: bytes, contentType: key === "FULL_PAGE" ? "image/jpeg" : "image/png" })
const URL_ = "https://example.com/"

beforeEach(() => {
  vi.clearAllMocks()
  h.noKey = false
  h.option = "B-prime"
  h.deleteAfter = true
  h.call.mockResolvedValue(RUN)
  h.listItems.mockResolvedValue({ items: [ITEM] })
  h.getRecord.mockImplementation(async (key: string) => record(key))
  h.listRequests.mockResolvedValue({ items: [] })
})

describe("knownCaptureCode", () => {
  it("keeps one of ours, maps anything else to capture_failed", () => {
    expect(knownCaptureCode("site_blocked")).toBe("site_blocked")
    expect(knownCaptureCode("storage_limit_exceeded")).toBe("storage_limit_exceeded")
    expect(knownCaptureCode("nope")).toBe("capture_failed")
    expect(knownCaptureCode(undefined)).toBe("capture_failed")
  })
})

describe("buildSiteCaptureInput", () => {
  it("our own actor: the page, the page script, the still count and the pinned proxy setting", () => {
    const input = buildSiteCaptureInput(URL_, 6)
    expect(Object.keys(input).sort()).toEqual(["maxStills", "pageScript", "proxyConfiguration", "url"])
    expect(input).toMatchObject({ url: URL_, maxStills: 6, proxyConfiguration: { useApifyProxy: false } })
    expect(String(input.pageScript)).toContain('"maxStills":6')
  })

  it("a generic scraper: one page, one retry, our page function, the pinned phone input", () => {
    h.option = "B"
    const input = buildSiteCaptureInput(URL_, 6)
    expect(input).toMatchObject({ startUrls: [{ url: URL_ }], maxRequestsPerCrawl: 1, maxRequestRetries: 1, proxyConfiguration: { useApifyProxy: false }, viewportWidth: 412 })
    expect(String(input.pageFunction)).toContain('"maxStills":6')
  })
})

describe("runSiteCapture", () => {
  it("calls the actor with the pinned build, memory, timeout, wait and no log streaming", async () => {
    await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(h.call).toHaveBeenCalledWith(expect.objectContaining({ url: URL_, maxStills: 8 }), { build: "1.2.3", memory: 4096, timeout: 150, waitSecs: 170, log: null })
  })

  it("reads the full page and every still by key", async () => {
    const run = await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(h.getRecord).toHaveBeenCalledWith("STILL_0", { buffer: true })
    expect(h.getRecord).toHaveBeenCalledWith("FULL_PAGE", { buffer: true })
    expect(run).toMatchObject({ providerRunId: "run-1", finalUrl: URL_, warnings: ["lazy_content_timeout"], pageText: "Pro $12 per month" })
    expect(run.stills.map((s) => [s.index, s.category, s.contentType])).toEqual([[0, "hero", "image/png"], [1, "feature", "image/png"]])
    expect(run.fullPage).toMatchObject({ contentType: "image/jpeg", truncated: false })
  })

  it("a run still running after the wait is aborted: capture_timeout", async () => {
    h.call.mockResolvedValue({ ...RUN, status: "RUNNING" })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "capture_timeout", providerRunId: "run-1" })
    expect(h.abort).toHaveBeenCalled()
  })

  it.each([
    ["blocked", "site_blocked"],
    ["empty", "site_empty"],
    ["unreachable", "site_unreachable"],
  ])("verdict %s throws %s with the run id", async (verdict, code) => {
    h.listItems.mockResolvedValue({ items: [{ ...ITEM, verdict, stills: [] }] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ name: "SiteCaptureError", code, providerRunId: "run-1" })
  })

  it("a 429 or 403 page is the page's verdict, not a navigation error", async () => {
    h.listItems.mockResolvedValue({ items: [{ ...ITEM, verdict: "blocked", status: 429, stills: [] }] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "site_blocked", providerRunId: "run-1" })
    expect(h.listRequests).not.toHaveBeenCalled()
  })

  it.each([
    [["net::ERR_NAME_NOT_RESOLVED at https://x.invalid/"], "site_unreachable"],
    [["net::ERR_CERT_DATE_INVALID"], "site_unreachable"],
    [["page.goto: Timeout 60000ms exceeded"], "capture_timeout"],
    [["something odd"], "capture_failed"],
  ])("no dataset item: %j → %s", async (errorMessages, code) => {
    h.listItems.mockResolvedValue({ items: [] })
    h.listRequests.mockResolvedValue({ items: [{ errorMessages }] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code, providerRunId: "run-1" })
  })

  it("reads our actor's navigation error item, with no request queue to read", async () => {
    h.listRequests.mockRejectedValue(new Error("Request queue was not found"))
    h.listItems.mockResolvedValue({
      items: [{ "#error": true, url: URL_, stage: "navigation", errorMessages: ["page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.com/"] }],
    })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "site_unreachable", providerRunId: "run-1" })
  })

  it("reads a navigation error from a scraper's #error item too", async () => {
    h.listItems.mockResolvedValue({ items: [{ "#error": true, "#debug": { errorMessages: ["net::ERR_CONNECTION_REFUSED"] } }] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "site_unreachable" })
  })

  it("classifies by the error messages only, never by the page address", async () => {
    const url = "https://example.com/certificate-timeout-guide"
    h.listItems.mockResolvedValue({ items: [{ "#error": true, url, stage: "pageScript", errorMessages: ["something odd"], "#debug": { url, errorMessages: ["something odd"] } }] })
    await expect(runSiteCapture({ url, maxStills: 8 })).rejects.toMatchObject({ code: "capture_failed" })
  })

  it("a run that failed on its input reads its status message: capture_failed", async () => {
    h.call.mockResolvedValue({ ...RUN, status: "FAILED", statusMessage: "input.url must be an http(s) URL" })
    h.listItems.mockResolvedValue({ items: [] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "capture_failed", providerRunId: "run-1" })
  })

  it("drops an oversize record with its warning", async () => {
    h.getRecord.mockImplementation(async (key: string) => (key === "STILL_1" ? record(key, Buffer.alloc(CAPTURE_RECORD_MAX_BYTES + 1)) : key === "FULL_PAGE" ? record(key, Buffer.alloc(CAPTURE_RECORD_MAX_BYTES + 1)) : record(key)))
    const run = await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(run.stills.map((s) => s.index)).toEqual([0])
    expect(run.fullPage).toBeNull()
    expect(run.warnings).toEqual(expect.arrayContaining(["still_dropped_oversize:1", "full_page_dropped_oversize"]))
  })

  it("a still missing from the store is dropped with still_missing", async () => {
    h.getRecord.mockImplementation(async (key: string) => (key === "STILL_0" ? undefined : record(key)))
    const run = await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(run.stills.map((s) => s.index)).toEqual([1])
    expect(run.warnings).toContain("still_missing:0")
  })

  it("a full page missing from the store is dropped with full_page_missing", async () => {
    h.getRecord.mockImplementation(async (key: string) => (key === "FULL_PAGE" ? undefined : record(key)))
    const run = await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(run.fullPage).toBeNull()
    expect(run.warnings).toContain("full_page_missing")
  })

  it("deletes the run's storages after a completed capture, never after a failed one; a failed delete is only logged", async () => {
    const warn = vi.fn()
    h.kvDelete.mockRejectedValueOnce(new Error("gone"))
    await runSiteCapture({ url: URL_, maxStills: 8 }, { warn })
    expect([h.kvDelete, h.dsDelete, h.rqDelete].every((f) => f.mock.calls.length === 1)).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }), expect.any(String))
    vi.clearAllMocks()
    h.listItems.mockResolvedValue({ items: [{ ...ITEM, verdict: "blocked", stills: [] }] })
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toBeInstanceOf(SiteCaptureError)
    expect(h.kvDelete).not.toHaveBeenCalled()
  })

  it("a delete that throws synchronously is only logged, and the capture still completes", async () => {
    const warn = vi.fn()
    h.rqDelete.mockImplementationOnce(() => {
      throw new Error("requestQueueId must be a string")
    })
    const run = await runSiteCapture({ url: URL_, maxStills: 8 }, { warn })
    expect(run.providerRunId).toBe("run-1")
    expect(h.kvDelete).toHaveBeenCalledTimes(1)
    expect(h.dsDelete).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("keeps the storages when deletion is switched off", async () => {
    h.deleteAfter = false
    await runSiteCapture({ url: URL_, maxStills: 8 })
    expect(h.kvDelete).not.toHaveBeenCalled()
  })

  it("a missing Apify key passes through untouched", async () => {
    h.noKey = true
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toBeInstanceOf(MissingProviderKeyError)
  })

  it("any other SDK error becomes a SiteCaptureError, never an ApifyError — a raw 403 is capture_failed, not site_blocked", async () => {
    h.call.mockRejectedValueOnce(new Error("403 Forbidden"))
    const err = await runSiteCapture({ url: URL_, maxStills: 8 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SiteCaptureError)
    expect(err).not.toBeInstanceOf(ApifyError)
    expect(err).toMatchObject({ code: "capture_failed", publicMessage: SITE_CAPTURE_MESSAGES.capture_failed })
    h.call.mockRejectedValueOnce(new Error("Request timeout after 170 s"))
    await expect(runSiteCapture({ url: URL_, maxStills: 8 })).rejects.toMatchObject({ code: "capture_timeout" })
  })
})

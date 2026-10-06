import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])

const h = vi.hoisted(() => ({
  store: vi.fn(),
  del: vi.fn(async (_opts: unknown) => ({ ok: true, r2Deleted: true })),
  eqs: [] as Array<[string, unknown]>,
  storage: true,
  fetch: vi.fn(),
}))

vi.mock("../media-import.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../media-import.js")>()),
  storeImportedImageBuffer: h.store,
}))
vi.mock("../asset-delete.js", () => ({ permanentlyDeleteAsset: h.del }))
vi.mock("../storage.js", () => ({ isStorageConfigured: () => h.storage }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: h.fetch }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => { h.eqs.push([col, v]); return chain },
        maybeSingle: async () => ({ data: { id: h.eqs.find(([c]) => c === "id")?.[1], r2_key: "uploads/images/x.png", size_bytes: 7, job_id: "job-1", relay_job_id: null }, error: null }),
      }
      return chain
    },
  },
}))

const { registerUploadPolicy, clearUploadPolicies } = await import("../upload-policy.js")
const { IMPORT_MAX_BYTES } = await vi.importActual<typeof import("../media-import.js")>("../media-import.js")
const store = await import("../site-capture-store.js")
const { CAPTURE_RECORD_MAX_BYTES } = await import("../../providers/apify/site-capture.js")
import type { SiteCaptureRun } from "../../providers/apify/site-capture.js"

const CTX = { userId: "u1", jobId: "job-1", pageUrl: "https://example.com/" }
const section = (order: number, category: "hero" | "feature" | "pricing" | "faq") => ({ order, label: `S${order}`, category, kind: category === "faq" ? "filler" as const : "key" as const, rect: { x: 0, y: order * 1000, width: 412, height: 600 }, text: "Pro $12 per month", stillIndex: order < 3 ? order : null })
const RUN: SiteCaptureRun = {
  providerRunId: "run-1",
  finalUrl: "https://www.example.com/",
  title: "Example",
  lang: "en",
  dir: "ltr",
  device: { width: 412, height: 915, dpr: 2.625 },
  fullPage: { bytes: JPG, contentType: "image/jpeg", truncated: false },
  stills: [0, 1, 2].map((i) => ({ bytes: PNG, contentType: "image/png", index: i, sectionOrder: i, label: `S${i}`, category: (["hero", "feature", "pricing"] as const)[i]! })),
  sections: [section(0, "hero"), section(1, "feature"), section(2, "pricing"), section(3, "faq")],
  pageText: "Pro $12 per month. Rated 4.8/5.",
  warnings: [],
}
let n = 0
const stored = () => ({ ok: true, url: `https://r2.example/a${++n}.png`, thumbnailUrl: null, assetId: `asset-${n}`, mimeType: "image/png", sizeBytes: 7, filename: "f", width: 1082, height: 1286 })

beforeEach(() => {
  vi.clearAllMocks()
  h.eqs.length = 0
  h.storage = true
  n = 0
  h.store.mockImplementation(async () => stored())
})
afterEach(() => clearUploadPolicies())

describe("storeLocalCapture", () => {
  it("stores each still then the full page with the documented arguments and builds the output", async () => {
    const { output, assetIds } = await store.storeLocalCapture(RUN, CTX)
    expect(h.store).toHaveBeenCalledTimes(4)
    expect(h.store.mock.calls[0]![0]).toEqual({
      userId: "u1", body: PNG, uploadSource: "url_import", sourceUrl: "https://www.example.com/", filename: "www.example.com-0-hero.png",
      source: "site-capture", sourceDetail: "www.example.com", inLibrary: false, jobId: "job-1",
    })
    expect(h.store.mock.calls[3]![0]).toMatchObject({ filename: "www.example.com-full.jpg", body: JPG })
    expect(assetIds).toEqual(["asset-1", "asset-2", "asset-3", "asset-4"])
    expect(Object.keys(output).sort()).toEqual(["device", "dir", "facts", "finalUrl", "fullPage", "lang", "pageUrl", "sections", "source", "stills", "title", "usableStills", "warnings"])
    expect(output).toMatchObject({ pageUrl: "https://example.com/", source: "local", usableStills: 3, fullPage: { assetId: "asset-4", truncated: false } })
    expect(output.stills[0]).toEqual({ index: 0, sectionOrder: 0, label: "S0", category: "hero", assetId: "asset-1", url: "https://r2.example/a1.png", width: 1082, height: 1286 })
    expect(output.facts).toEqual(expect.arrayContaining(["$12 per month", "4.8/5"]))
    expect(h.store.mock.calls.every(([a]) => !("relay_job_id" in (a as object)))).toBe(true)
  })

  it("a policy that denies the second still drops it as still_refused:1 and renumbers", async () => {
    const lanes: string[] = []
    let seen = 0
    registerUploadPolicy({ id: "deny-2nd", check: (i) => (lanes.push(i.lane), { allow: ++seen !== 2 }) })
    const { output } = await store.storeLocalCapture(RUN, CTX)
    expect(lanes.every((l) => l === "site-capture")).toBe(true)
    expect(output.warnings).toContain("still_refused:1")
    expect(output.stills.map((s) => [s.index, s.label])).toEqual([[0, "S0"], [1, "S2"]])
    expect(output.sections.map((s) => s.stillIndex)).toEqual([0, null, 1, null])
    expect(output.warnings).toContain("sections_below_minimum")
  })

  it("with no policy registered nothing is dropped", async () => {
    expect((await store.storeLocalCapture(RUN, CTX)).output.usableStills).toBe(3)
  })

  it("storage full at the third still deletes the two rows it wrote, scoped by user, and throws", async () => {
    h.store.mockImplementationOnce(async () => stored()).mockImplementationOnce(async () => stored()).mockImplementationOnce(async () => ({ ok: false, status: 413, code: "storage_limit_exceeded", message: "Storage limit exceeded" }))
    await expect(store.storeLocalCapture(RUN, CTX)).rejects.toBeInstanceOf(store.CaptureStorageFullError)
    expect(h.del).toHaveBeenCalledTimes(2)
    expect(h.del.mock.calls[0]![0]).toMatchObject({ userId: "u1", blockOnOwnJobReferrers: false, asset: { id: "asset-1", relay_job_id: null } })
    expect(h.eqs.filter(([c]) => c === "user_id").every(([, v]) => v === "u1")).toBe(true)
    expect(h.eqs.filter(([c]) => c === "user_id")).toHaveLength(2)
  })

  it("a still whose row was not written is still_store_failed", async () => {
    h.store.mockImplementationOnce(async () => ({ ...stored(), assetId: null }))
    const { output } = await store.storeLocalCapture(RUN, CTX)
    expect(output.warnings).toContain("still_store_failed:0")
  })

  it("a full page that fails to store or is refused leaves fullPage null and says why", async () => {
    h.store.mockImplementation(async (a: { filename: string }) => (a.filename.endsWith("-full.jpg") ? { ok: false, status: 400, code: "validation_error", message: "bad" } : stored()))
    expect((await store.storeLocalCapture(RUN, CTX)).output).toMatchObject({ fullPage: null, warnings: ["full_page_store_failed"] })
    registerUploadPolicy({ id: "no-full", check: (i) => ({ allow: !(i.filename ?? "").endsWith("-full.jpg") }) })
    expect((await store.storeLocalCapture(RUN, CTX)).output.warnings).toContain("full_page_refused")
  })
})

describe("restoreRelayCapture", () => {
  const CLOUD = {
    pageUrl: "https://example.com/", finalUrl: "https://example.com/", title: "Example", lang: "en", dir: "ltr",
    device: { width: 412, height: 915, dpr: 2.625 },
    fullPage: { assetId: "cloud-full", url: "https://cloud.r2/full.jpg", width: 1082, height: 9000, truncated: false },
    stills: [0, 1, 2].map((i) => ({ index: i, sectionOrder: i, label: `S${i}`, category: "feature", assetId: `cloud-${i}`, url: `https://cloud.r2/s${i}.png`, width: 1082, height: 1286 })),
    sections: [0, 1, 2].map((i) => ({ ...section(i, "feature"), stillIndex: i })),
    facts: ["$12/month"], usableStills: 3, warnings: [], source: "local",
  }

  it("re-stores every cloud image locally through safeFetch, replacing the asset ids", async () => {
    h.fetch.mockImplementation(async () => new Response(PNG, { status: 200 }))
    const { output, assetIds } = await store.restoreRelayCapture(CLOUD, CTX)
    expect(h.fetch).toHaveBeenCalledWith("https://cloud.r2/s0.png", expect.objectContaining({ timeoutMs: 30_000 }))
    expect(assetIds).toHaveLength(4)
    expect(output.stills.map((s) => s.assetId)).toEqual(["asset-1", "asset-2", "asset-3"])
    expect(output).toMatchObject({ source: "relay", facts: ["$12/month"], usableStills: 3 })
    expect(output.warnings).not.toContain("relay_urls_only")
    expect(h.store.mock.calls.every(([a]) => !("relay_job_id" in (a as object)))).toBe(true)
  })

  it("without local storage keeps the cloud URLs with assetId null and relay_urls_only", async () => {
    h.storage = false
    const { output, assetIds } = await store.restoreRelayCapture(CLOUD, CTX)
    expect(assetIds).toEqual([])
    expect(output.stills.map((s) => [s.assetId, s.url])).toEqual([[null, "https://cloud.r2/s0.png"], [null, "https://cloud.r2/s1.png"], [null, "https://cloud.r2/s2.png"]])
    expect(output.fullPage).toMatchObject({ assetId: null, url: "https://cloud.r2/full.jpg" })
    expect(output.warnings).toEqual(["relay_urls_only"])
  })

  it("one unreachable relay still keeps its cloud URL", async () => {
    h.fetch.mockImplementation(async (url: string) => (url.endsWith("s1.png") ? new Response("gone", { status: 404 }) : new Response(PNG, { status: 200 })))
    const { output } = await store.restoreRelayCapture(CLOUD, CTX)
    expect(output.stills.map((s) => s.assetId)).toEqual(["asset-1", null, "asset-2"])
    expect(output.stills[1]!.url).toBe("https://cloud.r2/s1.png")
    expect(output.warnings.filter((w) => w === "relay_urls_only")).toHaveLength(1)
  })
})

describe("deleteCaptureAssets and the shared cap", () => {
  it("reads every row by id AND user before deleting it", async () => {
    await store.deleteCaptureAssets("u1", ["a", "b"])
    expect(h.eqs).toEqual([["id", "a"], ["user_id", "u1"], ["id", "b"], ["user_id", "u1"]])
    expect(h.del).toHaveBeenCalledTimes(2)
  })
  it("the provider's record cap is the import cap", () => expect(CAPTURE_RECORD_MAX_BYTES).toBe(IMPORT_MAX_BYTES))
  it("sniffs PNG and JPEG", () => {
    expect(store.sniffImageMime(PNG)).toBe("image/png")
    expect(store.sniffImageMime(JPG)).toBe("image/jpeg")
  })
})

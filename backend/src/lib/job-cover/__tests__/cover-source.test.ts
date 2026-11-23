/**
 * The picture a caller names as a job's cover (decided 2026-11-23): one of
 * their own images on this platform, by asset id or by address; another
 * host, a file the caller did not make, a missing file, a file that is not a
 * picture, a format or a size outside the rule are each refused — real bytes
 * judged by sharp, and whose file it is judged by the real writer's allow
 * proof (lib/key-ownership.ts) over an in-memory database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  tables: { jobs: [] as Row[], assets: [] as Row[] } as Record<string, Row[]>,
  assetError: null as null | { message: string },
  head: { exists: true, sizeBytes: 1000 } as { exists: boolean; sizeBytes?: number },
  heads: [] as string[],
  body: Buffer.alloc(0) as Buffer,
  restricted: new Set<string>(),
}))

vi.mock("@/lib/supabase.js", () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), q),
      gt: () => q,
      order: () => q,
      limit: () => q,
      rows: () => (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
      maybeSingle: async () => (table === "assets" && h.assetError ? { data: null, error: h.assetError } : { data: q.rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: q.rows(), error: null }).then(resolve),
    }
    return q
  }
  return { supabase: { from } }
})
vi.mock("@/lib/content-restriction-set.js", () => ({ restrictedKeys: async () => h.restricted, restrictedKeysNow: () => h.restricted }))
vi.mock("@/lib/storage.js", () => ({
  isStorageConfigured: () => true,
  headR2Object: async (key: string) => (h.heads.push(key), h.head),
  readR2Object: async () => ({ body: h.body, contentType: "image/png", size: h.body.length }),
  r2Url: (k: string) => `https://cdn.test/${k}`,
}))

import { config } from "../../config.js"
import { _resetRecordedReferenceColumnForTests } from "../../key-ownership.js"
import { judgeCoverBytes, resolveJobCoverSource, JOB_COVER_MAX_BYTES } from "../cover-source.js"
import { newJobCoverKey } from "../cover-key.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const OWN_JOB = "f0000000-0000-4000-8000-000000000001"
const OTHER_JOB = "f0000000-0000-4000-8000-000000000002"
const CDN = "https://cdn.test"
const png = (w: number, h2: number) => sharp({ create: { width: w, height: h2, channels: 3, background: "#f06" } }).png().toBuffer()
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>')

let savedPublicUrl: string | undefined
beforeEach(async () => {
  savedPublicUrl = config.R2_PUBLIC_URL
  config.R2_PUBLIC_URL = CDN
  _resetRecordedReferenceColumnForTests()
  h.tables = {
    jobs: [{ id: OWN_JOB, user_id: USER }, { id: OTHER_JOB, user_id: OTHER }],
    assets: [
      // The caller's own upload: the row the upload path wrote when it stored the bytes.
      { id: "asset-own", user_id: USER, r2_key: "uploads/images/0a0a0a0a-0000-4000-8000-000000000001.png", r2_url: `${CDN}/uploads/images/0a0a0a0a-0000-4000-8000-000000000001.png`, upload_source: "manual_upload", size_bytes: 1000, recorded_reference: false },
      // The caller's library row that only RECORDS another user's preset picture.
      { id: "asset-recorded", user_id: USER, r2_key: `node-presets/${OTHER}/p.png`, r2_url: `${CDN}/node-presets/${OTHER}/p.png`, upload_source: "library", size_bytes: 0, recorded_reference: true },
    ],
  }
  h.assetError = null
  h.head = { exists: true, sizeBytes: 1000 }
  h.heads = []
  h.body = await png(400, 300)
  h.restricted = new Set(["images/restricted.png"])
})
afterEach(() => {
  config.R2_PUBLIC_URL = savedPublicUrl as string
})

describe("judgeCoverBytes", () => {
  it("accepts a png, jpeg, webp or gif within the size rule, with the extension to store", async () => {
    expect(await judgeCoverBytes(await png(400, 300))).toEqual({ ok: true, ext: "png" })
    expect(await judgeCoverBytes(await sharp(await png(64, 64)).jpeg().toBuffer())).toEqual({ ok: true, ext: "jpg" })
    expect(await judgeCoverBytes(await sharp(await png(100, 100)).webp().toBuffer())).toEqual({ ok: true, ext: "webp" })
    expect(await judgeCoverBytes(await sharp(await png(100, 100)).gif().toBuffer())).toEqual({ ok: true, ext: "gif" })
  })

  it("refuses what is not a picture, another format, a side under 64 px, and too many bytes", async () => {
    expect(await judgeCoverBytes(Buffer.from("not an image"))).toEqual({ ok: false, problem: "not_an_image" })
    expect(await judgeCoverBytes(svg)).toEqual({ ok: false, problem: "wrong_format" })
    expect(await judgeCoverBytes(await png(63, 200))).toEqual({ ok: false, problem: "wrong_size" })
    expect(await judgeCoverBytes(Buffer.alloc(JOB_COVER_MAX_BYTES + 1))).toEqual({ ok: false, problem: "too_large" })
  })

  it("a header that reads but pixels that do not decode (a truncated or corrupt file) is refused, not only a bad header", async () => {
    const whole = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#000", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer()
    const truncated = whole.subarray(0, Math.floor(whole.length / 2))
    // The header alone still says "a 512×512 png": the old header-only check passed it.
    const meta = await sharp(truncated).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 512, 512])
    expect(await judgeCoverBytes(truncated)).toEqual({ ok: false, problem: "not_an_image" })
  })
})

describe("resolveJobCoverSource — whose file (the writer's allow proof)", () => {
  it("an upload of the caller's, by asset id or by address: its file, judged", async () => {
    const key = "uploads/images/0a0a0a0a-0000-4000-8000-000000000001.png"
    expect(await resolveJobCoverSource(USER, { assetId: "asset-own" })).toEqual({ ok: true, sourceKey: key, ext: "png" })
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/${key}` })).toEqual({ ok: true, sourceKey: key, ext: "png" })
  })

  it("an output of the caller's own job is theirs; another user's job's output is not", async () => {
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/images/${OWN_JOB}.png` })).toMatchObject({ ok: true })
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/images/${OTHER_JOB}.png` })).toEqual({ ok: false, problem: "not_yours" })
  })

  it("another user's preset picture, clone, export or a template's kept file proves nobody made it for the caller: refused", async () => {
    for (const key of [`node-presets/${OTHER}/p.png`, `user-clones/${OTHER}/c.png`, `exports/${OTHER}/e.png`, "templates/00000000-0000-4000-8000-0000000000aa/kept/k.png"]) {
      expect(await resolveJobCoverSource(USER, { url: `${CDN}/${key}` }), key).toEqual({ ok: false, problem: "not_yours" })
    }
  })

  it("a library row that only RECORDS another user's file is not proof either", async () => {
    expect(await resolveJobCoverSource(USER, { assetId: "asset-recorded" })).toEqual({ ok: false, problem: "not_yours" })
  })

  it("the refusal comes before the storage is asked, so it never says whether another user's file exists", async () => {
    h.head = { exists: false }
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/node-presets/${OTHER}/gone.png` })).toEqual({ ok: false, problem: "not_yours" })
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/user-clones/${OTHER}/c.png` })).toEqual({ ok: false, problem: "not_yours" })
    expect(h.heads).toEqual([])
    // Only a file the caller provably made can be "missing".
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/images/${OWN_JOB}.png` })).toEqual({ ok: false, problem: "missing" })
  })

  it("another user's cover copy is refused; the caller's own is accepted", async () => {
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/job-covers/${OTHER}/cover-a.png` })).toEqual({ ok: false, problem: "not_yours" })
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/job-covers/${USER}/cover-a.png` })).toMatchObject({ ok: true })
  })

  it("an asset that is not the caller's answers as theirs to name, never whether it exists", async () => {
    expect(await resolveJobCoverSource(USER, { assetId: "asset-x" })).toEqual({ ok: false, problem: "not_yours" })
  })

  it("an address on another host is not a platform image", async () => {
    expect(await resolveJobCoverSource(USER, { url: "https://evil.example/a.png" })).toEqual({ ok: false, problem: "not_platform_image" })
  })
})

describe("resolveJobCoverSource — the file", () => {
  it("a file too large, and bytes that are not an accepted picture", async () => {
    const url = `${CDN}/images/${OWN_JOB}.png`
    h.head = { exists: true, sizeBytes: JOB_COVER_MAX_BYTES + 1 }
    expect(await resolveJobCoverSource(USER, { url })).toEqual({ ok: false, problem: "too_large" })
    h.head = { exists: true, sizeBytes: 100 }
    h.body = svg
    expect(await resolveJobCoverSource(USER, { url })).toEqual({ ok: false, problem: "wrong_format" })
  })

  it("a file under a content restriction, held as evidence, or a cover copied from restricted bytes, is refused", async () => {
    h.restricted = new Set([`images/${OWN_JOB}.png`])
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/images/${OWN_JOB}.png` })).toEqual({ ok: false, problem: "not_yours" })
    const copy = newJobCoverKey(USER, `images/${OWN_JOB}.png`, "png")
    expect(await resolveJobCoverSource(USER, { url: `${CDN}/${copy}` })).toEqual({ ok: false, problem: "not_yours" })
  })

  it("a failed asset lookup is thrown (the route answers 500), never read as 'not yours'", async () => {
    h.assetError = { message: "down" }
    await expect(resolveJobCoverSource(USER, { assetId: "asset-own" })).rejects.toThrow(/lookup failed/)
  })
})

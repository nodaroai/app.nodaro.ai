// @test-reads-none it reads only the temp files the helper under test writes, never a repo file
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { appendFile, chmod, stat } from "node:fs/promises"

/**
 * An input on our own storage, with its exact size (decided 2026-11-11): an
 * already-stored URL is answered by its canonical address, sized from
 * storage's own record and never fetched; anything else is downloaded through
 * the SSRF-safe fetch, capped on the bytes actually read, typed from its first
 * bytes, inspected locally, cleared by the upload policy and stored as a
 * scratch input under a full random name, whose URL passes the platform's
 * strict own-storage test. A quote's mode stores nothing.
 */

const h = vi.hoisted(() => ({
  /** Answers for the test hosts; anything else goes to the real SSRF-safe fetch. */
  responses: new Map<string, () => unknown>(),
  fetched: [] as string[],
  head: vi.fn(),
  uploads: [] as Array<{ key: string; contentType: string; body: Buffer }>,
  uploadError: undefined as Error | undefined,
  jobId: undefined as string | undefined,
}))

vi.mock("../safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safe-fetch.js")>()
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string, init?: unknown) => {
      h.fetched.push(url)
      const answer = h.responses.get(url)
      if (answer) return answer()
      return actual.safeFetch(url, init as Parameters<typeof actual.safeFetch>[1])
    }),
  }
})
vi.mock("../storage.js", async () => {
  const { r2KeyFromPublicUrl } = await import("../r2-public-key.js")
  const r2Url = (key: string) => `${process.env.R2_PUBLIC_URL}/${key}`
  return {
    isStorageConfigured: () => true,
    listObjectsByPrefixWithMeta: vi.fn(),
    uploadBufferToR2: vi.fn(),
    // As the real writer: stream the file under `key`, answer `r2Url(key)`.
    uploadFileWithKeyToR2: vi.fn(async (path: string, key: string, contentType: string) => {
      if (h.uploadError) throw h.uploadError
      h.uploads.push({ key, contentType, body: readFileSync(path) })
      return r2Url(key)
    }),
    headR2Object: h.head,
    r2KeyFromOurUrl: (url: string) => r2KeyFromPublicUrl(url, process.env.R2_PUBLIC_URL),
    r2Url,
  }
})
vi.mock("../upload-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../upload-policy.js")>()
  return { ...actual, applyUploadPolicies: vi.fn(actual.applyUploadPolicies) }
})
vi.mock("../supabase.js", () => ({ supabase: {} }))
vi.mock("../storage-delete.js", () => ({ deleteKeysRecordingFailures: vi.fn() }))
vi.mock("../job-cancellation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../job-cancellation.js")>()),
  getJobId: () => h.jobId,
}))

import {
  copyOutsideInput,
  inspectOutsideInput,
  isOutsideInputRefusal,
  OUTSIDE_INPUT_MAX_HOLD_MS,
  OUTSIDE_INPUT_MAX_INFLIGHT_GLOBAL,
  OUTSIDE_INPUT_QUOTE_SLOT_WAIT_MS,
  OUTSIDE_INPUT_SLOT_WAIT_MS,
  OutsideInputBusyError,
  OutsideInputFailedError,
  OutsideInputInspectRefusedError,
  outsideInputSlotsHeld,
  OutsideInputTimedOutError,
  OutsideInputTooLargeError,
  OutsideInputUnreadableError,
  OutsideInputWrongKindError,
  sniffInputType,
} from "../outside-input-copy.js"
import { isOwnStoredFileUrl } from "../own-storage-url.js"
import { applyUploadPolicies, clearUploadPolicies, registerUploadPolicy, UploadBlockedError, type UploadCheckInput } from "../upload-policy.js"
import { LinkImportsDisabledError } from "../link-imports.js"
import { JobCancelledError } from "../job-cancellation.js"

const CLOUD = "https://cdn.example.com"
const SELF_HOST = "http://localhost:3000/storage/nodaro-assets"
const JOB = "00000000-0000-4000-8000-0000000000aa"
const OUTSIDE = "https://media.example.test/clip.mp4"
const USER = "user-a"
/** An MP4's first bytes (`ftyp isom`), then filler. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(100, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)])
const UUID_NAME = "outside-input-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}"

/** A response whose body streams `chunks`, declaring `declared` bytes (or nothing). */
function respond(chunks: Buffer[], declared?: number, status = 200) {
  return () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(declared === undefined ? {} : { "content-length": String(declared) }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new Uint8Array(c))
        controller.close()
      },
    }),
  })
}

/** The options a video lane passes: its cap, its user, and an `inspect` that reads nothing. */
const video = (extra: Record<string, unknown> = {}) => ({ kind: "video" as const, maxBytes: 1_000, userId: USER, inspect: () => "ok", ...extra })

const savedBase = process.env.R2_PUBLIC_URL
beforeEach(() => {
  process.env.R2_PUBLIC_URL = CLOUD
  h.responses.clear()
  h.fetched = []
  h.uploads = []
  h.uploadError = undefined
  h.jobId = undefined
  h.head.mockReset()
  vi.mocked(applyUploadPolicies).mockClear()
  clearUploadPolicies()
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  process.env.R2_PUBLIC_URL = savedBase
  clearUploadPolicies()
  expect(outsideInputSlotsHeld("copy")).toBe(0)
  expect(outsideInputSlotsHeld("quote")).toBe(0)
})

describe("an input already on our storage", () => {
  const KEY = "uploads/videos/0b6f5d2e-1111-4222-8333-444455556666.mp4"
  const STORED = `${CLOUD}/${KEY}`

  it("is answered by its own address, sized from storage's own record, never fetched and never inspected", async () => {
    h.head.mockResolvedValue({ exists: true, sizeBytes: 12_345 })
    const inspect = vi.fn()
    const out = await copyOutsideInput(STORED, video({ maxBytes: 50_000_000, inspect }))
    expect(out).toEqual({ url: STORED, bytes: 12_345, copied: false })
    expect(h.head).toHaveBeenCalledWith(KEY)
    expect(h.fetched).toEqual([])
    expect(inspect).not.toHaveBeenCalled()
    expect(h.uploads).toEqual([])
  })

  it("with a query or a fragment is answered by the canonical address of the key it measured", async () => {
    h.head.mockResolvedValue({ exists: true, sizeBytes: 10 })
    for (const extra of ["?w=10", "#frag", "?w=10#frag"]) {
      const out = await copyOutsideInput(`${STORED}${extra}`, video())
      expect(out.url).toBe(STORED)
      expect(isOwnStoredFileUrl(out.url)).toBe(true)
    }
    expect(h.head.mock.calls.every(([key]) => key === KEY)).toBe(true)
  })

  it("whose key is not plain is refused as unreadable, and never asked about", async () => {
    await expect(copyOutsideInput(`${CLOUD}//images/a.png`, video())).rejects.toBeInstanceOf(OutsideInputUnreadableError)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("in a kept folder is refused as unreadable, and never asked about", async () => {
    await expect(copyOutsideInput(`${CLOUD}/evidence/abc/def.mp4`, video())).rejects.toBeInstanceOf(OutsideInputUnreadableError)
    await expect(inspectOutsideInput(`${CLOUD}/evidence/abc/def.mp4`, video())).rejects.toBeInstanceOf(OutsideInputUnreadableError)
    expect(h.head).not.toHaveBeenCalled()
  })

  it("over the cap is refused as too large, with no fetch", async () => {
    h.head.mockResolvedValue({ exists: true, sizeBytes: 50_000_001 })
    await expect(copyOutsideInput(STORED, video({ maxBytes: 50_000_000 }))).rejects.toBeInstanceOf(OutsideInputTooLargeError)
    expect(h.fetched).toEqual([])
  })

  it("whose object does not exist is refused as unreadable, with no fetch", async () => {
    h.head.mockResolvedValue({ exists: false })
    await expect(copyOutsideInput(STORED, video())).rejects.toBeInstanceOf(OutsideInputUnreadableError)
    expect(h.fetched).toEqual([])
  })

  it("on a self-host storage base too", async () => {
    process.env.R2_PUBLIC_URL = SELF_HOST
    const url = `${SELF_HOST}/uploads/images/0b6f5d2e-1111-4222-8333-444455556666.png`
    h.head.mockResolvedValue({ exists: true, sizeBytes: 900 })
    expect(await copyOutsideInput(url, { kind: "image", maxBytes: 1_000, userId: USER, inspect: () => 0 })).toEqual({ url, bytes: 900, copied: false })
    expect(h.fetched).toEqual([])
  })

  it("a storage failure while sizing it reads as one fixed sentence, the original logged only", async () => {
    h.head.mockRejectedValue(new Error("HEAD https://account.r2.cloudflarestorage.example/bucket/uploads/a.mp4: 500"))
    const err = await copyOutsideInput(STORED, video()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputFailedError)
    expect((err as Error).message).toBe("The file could not be prepared. Try again in a moment.")
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes("cloudflarestorage"))).toBe(true)
  })
})

describe("an outside input", () => {
  it.each([["cloud", CLOUD], ["self-host", SELF_HOST]])(
    "is copied into the job's scratch folder under a full random name, and the URL returned passes the strict own-storage test (%s storage)",
    async (_name, base) => {
      process.env.R2_PUBLIC_URL = base
      h.responses.set(OUTSIDE, respond([MP4]))
      const out = await copyOutsideInput(OUTSIDE, video({ jobId: JOB }))
      expect(out.copied).toBe(true)
      expect(out.bytes).toBe(MP4.length)
      expect(isOwnStoredFileUrl(out.url)).toBe(true)
      expect(out.url).toMatch(new RegExp(`^${base.replace(/[.]/g, "\\.")}/tmp/provider-input/${JOB}/${UUID_NAME}\\.mp4$`))
      expect(h.uploads).toHaveLength(1)
      expect(h.uploads[0]!.body.equals(MP4)).toBe(true)
      // Typed from its own first bytes, never from the remote server's word.
      expect(h.uploads[0]!.contentType).toBe("video/mp4")
    },
  )

  it("with no job id goes to the running job's folder, else the flat scratch key, never twice under one name", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    h.jobId = JOB
    expect((await copyOutsideInput(OUTSIDE, video())).url).toMatch(new RegExp(`/tmp/provider-input/${JOB}/${UUID_NAME}\\.mp4$`))
    h.jobId = undefined
    const a = await copyOutsideInput(OUTSIDE, video())
    const b = await copyOutsideInput(OUTSIDE, video())
    expect(a.url).toMatch(new RegExp(`/tmp/provider-input/${UUID_NAME}\\.mp4$`))
    expect(a.url).not.toBe(b.url)
  })

  it("that is not of the lane's kind is refused, with nothing stored", async () => {
    h.responses.set(OUTSIDE, respond([PNG]))
    const inspect = vi.fn()
    const err = await copyOutsideInput(OUTSIDE, video({ inspect })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputWrongKindError)
    expect((err as OutsideInputWrongKindError).code).toBe("input_wrong_kind")
    expect(inspect).not.toHaveBeenCalled()
    h.responses.set(OUTSIDE, respond([Buffer.from("not media at all")]))
    await expect(copyOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(OutsideInputWrongKindError)
    expect(h.uploads).toEqual([])
  })

  it("that declares a small length but streams past the cap is refused, with nothing stored", async () => {
    h.responses.set(OUTSIDE, respond([Buffer.alloc(40), Buffer.alloc(40), Buffer.alloc(40)], 10))
    const inspect = vi.fn()
    await expect(copyOutsideInput(OUTSIDE, video({ maxBytes: 100, inspect }))).rejects.toBeInstanceOf(OutsideInputTooLargeError)
    expect(inspect).not.toHaveBeenCalled()
    expect(h.uploads).toEqual([])
  })

  it("that declares a length over the cap is refused before its body is read", async () => {
    h.responses.set(OUTSIDE, respond([MP4], 5_000))
    await expect(copyOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(OutsideInputTooLargeError)
    expect(h.uploads).toEqual([])
  })

  it("that cannot be fetched is refused as unreadable, in words that name no address", async () => {
    h.responses.set(OUTSIDE, respond([], undefined, 404))
    const err = await copyOutsideInput(OUTSIDE, video()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputUnreadableError)
    expect(isOutsideInputRefusal(err)).toBe(true)
    expect((err as Error).message).not.toContain("example")
    expect(h.uploads).toEqual([])
  })

  it("on a private address is refused by the SSRF-safe fetch, as unreadable", async () => {
    const err = await copyOutsideInput("http://127.0.0.1:9/clip.mp4", video()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputUnreadableError)
    expect((err as Error).message).not.toContain("127.0.0.1")
    expect(h.uploads).toEqual([])
  })

  it("is inspected read-only from the local file before anything is stored; the result is returned and the temp file removed", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    let seen = ""
    const out = await copyOutsideInput(OUTSIDE, video({
      inspect: async (path: string) => {
        seen = path
        expect(readFileSync(path).equals(MP4)).toBe(true)
        expect((await stat(path)).mode & 0o777).toBe(0o400)
        expect(h.uploads).toEqual([])
        return { durationSec: 9.4 }
      },
    }))
    expect(out.inspected).toEqual({ durationSec: 9.4 })
    expect(existsSync(seen)).toBe(false)
  })

  it("is sized and typed AFTER inspect: what is stored is what is reported", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    const out = await copyOutsideInput(OUTSIDE, video({
      inspect: async (path: string) => { await chmod(path, 0o600); await appendFile(path, Buffer.alloc(20, 9)) },
    }))
    expect(out.bytes).toBe(MP4.length + 20)
    expect(h.uploads[0]!.body.length).toBe(out.bytes)
    // A rewrite past the cap, or into another kind, is refused.
    h.responses.set(OUTSIDE, respond([MP4]))
    await expect(copyOutsideInput(OUTSIDE, video({
      maxBytes: MP4.length + 5,
      inspect: async (path: string) => { await chmod(path, 0o600); await appendFile(path, Buffer.alloc(20)) },
    }))).rejects.toBeInstanceOf(OutsideInputTooLargeError)
    expect(h.uploads).toHaveLength(1)
  })

  it("that inspect refuses is not stored, the temp file is removed, and the lane's own error is the reason", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    const tooLong = new Error("clip too long")
    let seen = ""
    const err = await copyOutsideInput(OUTSIDE, video({ inspect: (path: string) => { seen = path; throw tooLong } })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputInspectRefusedError)
    expect((err as OutsideInputInspectRefusedError).reason).toBe(tooLong)
    expect((err as Error).cause).toBeUndefined()
    expect(h.uploads).toEqual([])
    expect(existsSync(seen)).toBe(false)
  })

  it("a job stopped while inspect runs is thrown as it is, never as a refused file, with nothing stored and no temp file", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    const cancelled = new JobCancelledError(JOB)
    let seen = ""
    const err = await copyOutsideInput(OUTSIDE, video({ inspect: (path: string) => { seen = path; throw cancelled } })).catch((e: unknown) => e)
    expect(err).toBe(cancelled)
    expect(h.uploads).toEqual([])
    expect(existsSync(seen)).toBe(false)
    // The caller's own abort, too: its reason, not a refusal.
    const ctrl = new AbortController()
    const why = new Error("request closed")
    const aborted = await copyOutsideInput(OUTSIDE, video({
      signal: ctrl.signal,
      inspect: () => { ctrl.abort(why); throw new Error("ffprobe interrupted") },
    })).catch((e: unknown) => e)
    expect(aborted).toBe(why)
  })

  it("asks the upload policy with the type its bytes show, and a denial stores nothing", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    const asked: UploadCheckInput[] = []
    registerUploadPolicy({ id: "test-gate", check: (input) => { asked.push(input); return { allow: false, reason: "Not here." } } })
    const err = await copyOutsideInput(OUTSIDE, video()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadBlockedError)
    expect((err as Error).message).toBe("Not here.")
    expect(h.uploads).toEqual([])
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ kind: "video", lane: "media-import", mime: "video/mp4", sizeBytes: MP4.length, userId: USER })
    // A real copy is no dry run: the policy counts it.
    expect(asked[0]).not.toHaveProperty("quote")
    expect(asked[0]!.buffer!.equals(MP4)).toBe(true)
  })

  it("reads no sample and asks nothing when no upload policy is registered", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    expect((await copyOutsideInput(OUTSIDE, video())).copied).toBe(true)
    expect(applyUploadPolicies).not.toHaveBeenCalled()
    registerUploadPolicy({ id: "test-gate", check: () => ({ allow: true }) })
    expect((await copyOutsideInput(OUTSIDE, video())).copied).toBe(true)
    expect(applyUploadPolicies).toHaveBeenCalledTimes(1)
  })

  it("a storage or file-system failure reads as one fixed sentence: no temp path, key or endpoint reaches the caller", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    h.uploadError = new Error("PUT https://account.r2.cloudflarestorage.example/bucket/tmp/provider-input/x.mp4 from /tmp/outside-input-abc/input failed")
    const err = await copyOutsideInput(OUTSIDE, video()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OutsideInputFailedError)
    expect((err as OutsideInputFailedError).code).toBe("input_failed")
    expect((err as Error).message).not.toMatch(/tmp|r2|bucket|R2_PUBLIC_URL/i)
    expect((err as Error).cause).toBeUndefined()
  })

  it("is refused before any fetch where the deployment turned links to outside content off (a stored input is not)", async () => {
    const { __resetSurfaceProfileCacheForTests } = await import("../surface-profile.js")
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
    __resetSurfaceProfileCacheForTests()
    try {
      h.responses.set(OUTSIDE, respond([MP4]))
      await expect(copyOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(LinkImportsDisabledError)
      await expect(inspectOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(LinkImportsDisabledError)
      expect(h.fetched).toEqual([])
      h.head.mockResolvedValue({ exists: true, sizeBytes: 10 })
      expect((await copyOutsideInput(`${CLOUD}/uploads/videos/a.mp4`, video())).copied).toBe(false)
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })
})

describe("the quote's mode (inspectOutsideInput)", () => {
  it("downloads, caps, types, inspects and asks the upload policy of an outside input exactly as a run would, and stores nothing", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    const asked: UploadCheckInput[] = []
    registerUploadPolicy({ id: "test-gate", check: (input) => { asked.push(input); return { allow: true } } })
    let seen = ""
    const out = await inspectOutsideInput(OUTSIDE, { kind: "video", maxBytes: 1_000, userId: USER, inspect: (p) => { seen = p; return 9.4 } })
    expect(out).toEqual({ bytes: MP4.length, outside: true, inspected: 9.4 })
    expect(h.uploads).toEqual([])
    // The policy reads the same bytes a copy would show it, under the same lane.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ kind: "video", lane: "media-import", sizeBytes: MP4.length, userId: USER, quote: true })
    expect(asked[0]!.buffer?.equals(MP4)).toBe(true)
    expect(existsSync(seen)).toBe(false)
    h.responses.set(OUTSIDE, respond([Buffer.alloc(40), Buffer.alloc(40)], 10))
    await expect(inspectOutsideInput(OUTSIDE, { kind: "video", maxBytes: 50, userId: USER })).rejects.toBeInstanceOf(OutsideInputTooLargeError)
  })

  it("refuses what the upload policy denies, as a copy would, and stores nothing", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    registerUploadPolicy({ id: "test-gate", check: () => ({ allow: false, reason: "Not here." }) })
    await expect(inspectOutsideInput(OUTSIDE, { kind: "video", maxBytes: 1_000, userId: USER })).rejects.toBeInstanceOf(UploadBlockedError)
    expect(h.uploads).toEqual([])
    expect(outsideInputSlotsHeld("quote")).toBe(0)
  })

  it("sizes an already-stored input from storage, with no fetch", async () => {
    h.head.mockResolvedValue({ exists: true, sizeBytes: 777 })
    expect(await inspectOutsideInput(`${CLOUD}/uploads/videos/a.mp4`, { kind: "video", maxBytes: 1_000, userId: USER })).toEqual({ bytes: 777, outside: false })
    expect(h.fetched).toEqual([])
  })
})

describe("download slots (per user and in all, in this process)", () => {
  /** A response held until `open()` is called: the download keeps its slot meanwhile. */
  function held() {
    let open = () => {}
    const gate = new Promise<void>((r) => { open = r })
    return { answer: async () => { await gate; return respond([MP4])() }, open: () => open() }
  }
  const urlFor = (i: number) => `https://media.example.test/clip-${i}.mp4`

  it("holds the per-user limit: a third download for one user waits, then is refused as busy (not too large, not unreadable)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const gate = held()
    for (const i of [1, 2, 3]) h.responses.set(urlFor(i), gate.answer)
    const p1 = copyOutsideInput(urlFor(1), video())
    const p2 = copyOutsideInput(urlFor(2), video())
    const p3 = copyOutsideInput(urlFor(3), video()).catch((e: unknown) => e)
    await vi.waitFor(() => expect(outsideInputSlotsHeld("copy", USER)).toBe(2))
    // Another user is not held back by user-a.
    h.responses.set(urlFor(4), respond([MP4]))
    expect((await copyOutsideInput(urlFor(4), video({ userId: "user-b" }))).copied).toBe(true)
    await vi.advanceTimersByTimeAsync(OUTSIDE_INPUT_SLOT_WAIT_MS)
    const busy = await p3
    expect(busy).toBeInstanceOf(OutsideInputBusyError)
    expect((busy as OutsideInputBusyError).code).toBe("input_busy")
    expect(h.fetched).not.toContain(urlFor(3))
    gate.open()
    await Promise.all([p1, p2])
  })

  it("a waiting download takes the slot a finished one frees", async () => {
    const gate = held()
    for (const i of [1, 2]) h.responses.set(urlFor(i), gate.answer)
    h.responses.set(urlFor(3), respond([MP4]))
    const p = [1, 2, 3].map((i) => copyOutsideInput(urlFor(i), video()))
    await vi.waitFor(() => expect(outsideInputSlotsHeld("copy", USER)).toBe(2))
    gate.open()
    expect((await Promise.all(p)).map((r) => r.copied)).toEqual([true, true, true])
  })

  it("holds the global limit across users", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const gate = held()
    const running: Array<Promise<unknown>> = []
    for (let i = 0; i < OUTSIDE_INPUT_MAX_INFLIGHT_GLOBAL; i++) {
      h.responses.set(urlFor(i), gate.answer)
      running.push(copyOutsideInput(urlFor(i), video({ userId: `user-${i}` })))
    }
    await vi.waitFor(() => expect(outsideInputSlotsHeld("copy")).toBe(OUTSIDE_INPUT_MAX_INFLIGHT_GLOBAL))
    h.responses.set(urlFor(99), respond([MP4]))
    const over = copyOutsideInput(urlFor(99), video({ userId: "user-99" })).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(OUTSIDE_INPUT_SLOT_WAIT_MS)
    expect(await over).toBeInstanceOf(OutsideInputBusyError)
    gate.open()
    await Promise.all(running)
  })

  it("quotes draw on their own, smaller set: a busy quote never holds back a run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const gate = held()
    h.responses.set(urlFor(1), gate.answer)
    h.responses.set(urlFor(2), gate.answer)
    const quote = inspectOutsideInput(urlFor(1), { kind: "video", maxBytes: 1_000, userId: USER })
    await vi.waitFor(() => expect(outsideInputSlotsHeld("quote", USER)).toBe(1))
    // The user's second quote waits briefly, then is refused.
    const second = inspectOutsideInput(urlFor(2), { kind: "video", maxBytes: 1_000, userId: USER }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(OUTSIDE_INPUT_QUOTE_SLOT_WAIT_MS)
    expect(await second).toBeInstanceOf(OutsideInputBusyError)
    // A run for the same user still has its own slots.
    h.responses.set(urlFor(3), respond([MP4]))
    expect((await copyOutsideInput(urlFor(3), video())).copied).toBe(true)
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    gate.open()
    await quote
  })

  it("an already-stored input takes no slot, even when its user's are all held", async () => {
    const gate = held()
    for (const i of [1, 2]) h.responses.set(urlFor(i), gate.answer)
    const p = [1, 2].map((i) => copyOutsideInput(urlFor(i), video()))
    await vi.waitFor(() => expect(outsideInputSlotsHeld("copy", USER)).toBe(2))
    h.head.mockResolvedValue({ exists: true, sizeBytes: 10 })
    const stored = await copyOutsideInput(`${CLOUD}/uploads/videos/a.mp4`, video())
    expect(stored.copied).toBe(false)
    expect(outsideInputSlotsHeld("copy", USER)).toBe(2)
    gate.open()
    await Promise.all(p)
  })

  it("gives the slot back after a success, a refusal, a throwing inspect, a cancellation and a policy denial", async () => {
    h.responses.set(OUTSIDE, respond([MP4]))
    await copyOutsideInput(OUTSIDE, video())
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    h.responses.set(OUTSIDE, respond([Buffer.alloc(2_000)]))
    await expect(copyOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(OutsideInputTooLargeError)
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    h.responses.set(OUTSIDE, respond([], undefined, 500))
    await expect(inspectOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(OutsideInputUnreadableError)
    expect(outsideInputSlotsHeld("quote")).toBe(0)
    h.responses.set(OUTSIDE, respond([MP4]))
    await expect(copyOutsideInput(OUTSIDE, video({ inspect: () => { throw new Error("too long") } }))).rejects.toBeInstanceOf(OutsideInputInspectRefusedError)
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    const cancelled = new JobCancelledError(JOB)
    await expect(copyOutsideInput(OUTSIDE, video({ inspect: () => { throw cancelled } }))).rejects.toBe(cancelled)
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    registerUploadPolicy({ id: "test-gate", check: () => ({ allow: false }) })
    await expect(copyOutsideInput(OUTSIDE, video())).rejects.toBeInstanceOf(UploadBlockedError)
    expect(outsideInputSlotsHeld("copy", USER)).toBe(0)
  })

  it("a call aborted while it waits for a slot gives up with its abort, holding nothing", async () => {
    const gate = held()
    for (const i of [1, 2]) h.responses.set(urlFor(i), gate.answer)
    const p = [1, 2].map((i) => copyOutsideInput(urlFor(i), video()))
    await vi.waitFor(() => expect(outsideInputSlotsHeld("copy", USER)).toBe(2))
    const ctrl = new AbortController()
    const waiting = copyOutsideInput(urlFor(3), video({ signal: ctrl.signal })).catch((e: unknown) => e)
    const why = new Error("request closed")
    ctrl.abort(why)
    expect(await waiting).toBe(why)
    expect(outsideInputSlotsHeld("copy", USER)).toBe(2)
    gate.open()
    await Promise.all(p)
  })

  it("holds a slot at most OUTSIDE_INPUT_MAX_HOLD_MS: a hung inspect is told, the slot and the temp file go, and nothing is stored when it finally returns", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    h.responses.set(OUTSIDE, respond([MP4]))
    let finish = () => {}
    let seen = ""
    let told: AbortSignal | undefined
    const hung = new Promise<string>((r) => { finish = () => r("late") })
    const out = copyOutsideInput(OUTSIDE, video({ inspect: (p: string, signal: AbortSignal) => { seen = p; told = signal; return hung } })).catch((e: unknown) => e)
    await vi.waitFor(() => expect(seen).not.toBe(""))
    expect(told!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(OUTSIDE_INPUT_MAX_HOLD_MS)
    expect(await out).toBeInstanceOf(OutsideInputTimedOutError)
    expect(told!.aborted).toBe(true)
    expect(outsideInputSlotsHeld("copy")).toBe(0)
    expect(existsSync(seen)).toBe(false)
    finish()
    await vi.advanceTimersByTimeAsync(10)
    expect(h.uploads).toEqual([])
  })
})

describe("the options a lane passes", () => {
  it("refuses a missing user, a copy with no check of its own, a cap or a time limit outside the fetch's own ceilings", async () => {
    await expect(copyOutsideInput(OUTSIDE, video({ userId: "" }))).rejects.toThrow(/userId/)
    await expect(inspectOutsideInput(OUTSIDE, { kind: "video", maxBytes: 100 } as never)).rejects.toThrow(/userId/)
    await expect(copyOutsideInput(OUTSIDE, { kind: "video", maxBytes: 100, userId: USER } as never)).rejects.toThrow(/inspect is required/)
    await expect(copyOutsideInput(OUTSIDE, video({ maxBytes: 0 }))).rejects.toThrow(/maxBytes/)
    await expect(copyOutsideInput(OUTSIDE, video({ maxBytes: 600 * 1024 * 1024 }))).rejects.toThrow(/maxBytes/)
    await expect(copyOutsideInput(OUTSIDE, video({ timeoutMs: 300_000 }))).rejects.toThrow(/timeoutMs/)
    expect(h.fetched).toEqual([])
  })
})

describe("sniffInputType (real header bytes)", () => {
  const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex")
  /** Chrome's MediaRecorder `audio/webm;codecs=opus`: the EBML header, DocType "webm". */
  const CHROME_OPUS_WEBM = hex("1a45dfa3 9f 4286 81 01 42f7 81 01 42f2 81 04 42f3 81 08 4282 84 7765626d 4287 81 04 4285 81 02")
  /** An M4A from a phone or an encoder: `ftyp isom`, compatible isom/iso2/mp41. */
  const ISOM_M4A = hex("00000020 66747970 69736f6d 00000200 69736f6d 69736f32 6d703431 00000008")
  /** A QuickTime file whose first box is `moov` (no `ftyp`), then its `mvhd`. */
  const MOOV_FIRST_MOV = hex("00000a1c 6d6f6f76 0000006c 6d766864 00000000")
  /** An RF64 (64-bit) WAV: `RF64`, size -1, `WAVE`, then `ds64`. */
  const RF64_WAV = hex("52463634 ffffffff 57415645 64733634")
  /** An ADTS AAC frame (MPEG-4, layer 00, no CRC) and an MPEG-1 Layer III frame. */
  const ADTS_FRAME = hex("fff15080 2bfffc21")
  const MP3_FRAME = hex("fffb9064 00000000")
  /** A HEIF image: `ftyp heim`, compatible mif1/heim. */
  const HEIM_HEIF = hex("00000018 66747970 6865696d 00000000 6d696631 6865696d")

  it("takes a sound-or-picture container for either kind, typed by the kind asked for", () => {
    expect(sniffInputType(CHROME_OPUS_WEBM, "audio")).toEqual({ ext: "webm", contentType: "audio/webm" })
    expect(sniffInputType(CHROME_OPUS_WEBM, "video")).toEqual({ ext: "webm", contentType: "video/webm" })
    expect(sniffInputType(ISOM_M4A, "audio")).toEqual({ ext: "m4a", contentType: "audio/mp4" })
    expect(sniffInputType(ISOM_M4A, "video")).toEqual({ ext: "mp4", contentType: "video/mp4" })
    expect(sniffInputType(Buffer.from("OggS\u0000\u0002"), "audio")).toEqual({ ext: "ogg", contentType: "audio/ogg" })
    expect(sniffInputType(Buffer.from("OggS\u0000\u0002"), "video")).toEqual({ ext: "ogv", contentType: "video/ogg" })
    expect(sniffInputType(CHROME_OPUS_WEBM, "image")).toBeUndefined()
  })

  it("takes a QuickTime file whose first box is not ftyp, as a video", () => {
    expect(sniffInputType(MOOV_FIRST_MOV, "video")).toEqual({ ext: "mov", contentType: "video/quicktime" })
    expect(sniffInputType(hex("00000008 77696465 00000000 6d646174"), "video")).toEqual({ ext: "mov", contentType: "video/quicktime" })
    expect(sniffInputType(MOOV_FIRST_MOV, "audio")).toBeUndefined()
  })

  it("takes an RF64 WAV, and tells an ADTS AAC frame from an MP3 frame", () => {
    expect(sniffInputType(RF64_WAV, "audio")).toEqual({ ext: "wav", contentType: "audio/wav" })
    expect(sniffInputType(Buffer.concat([Buffer.from("BW64"), RF64_WAV.subarray(4)]), "audio")).toEqual({ ext: "wav", contentType: "audio/wav" })
    expect(sniffInputType(ADTS_FRAME, "audio")).toEqual({ ext: "aac", contentType: "audio/aac" })
    expect(sniffInputType(MP3_FRAME, "audio")).toEqual({ ext: "mp3", contentType: "audio/mpeg" })
    expect(sniffInputType(Buffer.from("ID3\u0004\u0000"), "audio")).toEqual({ ext: "mp3", contentType: "audio/mpeg" })
    expect(sniffInputType(RF64_WAV, "video")).toBeUndefined()
  })

  it("takes HEIF and AVIF brands as images only, and keeps TIFF and BMP", () => {
    expect(sniffInputType(HEIM_HEIF, "image")).toEqual({ ext: "heic", contentType: "image/heic" })
    for (const brand of ["heis", "hevc", "hevx", "heix"]) {
      expect(sniffInputType(Buffer.concat([HEIM_HEIF.subarray(0, 8), Buffer.from(brand)]), "image"), brand).toEqual({ ext: "heic", contentType: "image/heic" })
    }
    expect(sniffInputType(HEIM_HEIF, "video")).toBeUndefined()
    expect(sniffInputType(HEIM_HEIF, "audio")).toBeUndefined()
    expect(sniffInputType(Buffer.from("II*\u0000\u0008\u0000"), "image")).toEqual({ ext: "tiff", contentType: "image/tiff" })
    expect(sniffInputType(Buffer.from("BM6\u0000"), "image")).toEqual({ ext: "bmp", contentType: "image/bmp" })
  })

  it("refuses a file that shows no format of the kind asked for", () => {
    expect(sniffInputType(MP4, "image")).toBeUndefined()
    expect(sniffInputType(PNG, "video")).toBeUndefined()
    expect(sniffInputType(Buffer.from("hello world!"), "video")).toBeUndefined()
  })

  it("copies an Opus WebM for the audio kind, stored as audio/webm", async () => {
    h.responses.set(OUTSIDE, respond([CHROME_OPUS_WEBM]))
    const out = await copyOutsideInput(OUTSIDE, { kind: "audio", maxBytes: 1_000, userId: USER, inspect: () => "opus" })
    expect(out.url).toMatch(/\.webm$/)
    expect(h.uploads[0]!.contentType).toBe("audio/webm")
  })
})

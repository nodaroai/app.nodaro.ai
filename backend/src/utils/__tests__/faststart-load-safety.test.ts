/**
 * Load-safety knobs on the faststart rewrite (decided 2026-10-08):
 *  1. at most N concurrent remuxes on the FILE lane (the URL import) per
 *     process, N from UPLOAD_FASTSTART_MAX_FILE_REMUXES (default 2); past it
 *     the file is stored as sent and the skip is logged as a warning;
 *  2. a file is remuxed only when free disk (less what running remuxes have
 *     already promised) is at least 2x the file's size.
 * No real ffmpeg: the launcher is a gate the test opens, ffprobe answers a fixed shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const state = vi.hoisted(() => ({ max: 2, release: undefined as undefined | (() => void), gate: undefined as undefined | Promise<void> }))
vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  uploadFaststartMaxFileRemuxes: () => state.max,
}))
vi.mock("../../providers/video/ffmpeg-cancellable.js", () => ({
  runFfmpegCancellable: vi.fn(async () => { await state.gate; throw new Error("released") }),
}))
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  runFfprobe: vi.fn(async () => JSON.stringify({ format: { duration: "3.0", nb_streams: 2 } })),
}))

import { runFfmpegCancellable } from "../../providers/video/ffmpeg-cancellable.js"
import {
  faststartBuffersInFlight,
  faststartFileRemuxesInFlight,
  faststartReservedDiskBytes,
  faststartVideoBuffer,
  faststartVideoFile,
  noteFaststartOutcome,
} from "../faststart.js"

const MARGIN = 256 * 1024 * 1024
const GIB = 1024 ** 3

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + payload.length, 0)
  head.write(type, 4, "latin1")
  return Buffer.concat([head, payload])
}
const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isom")]))
const smallMoovLast = Buffer.concat([ftyp, box("mdat", Buffer.alloc(64)), box("moov", Buffer.alloc(32))])

let dir: string
beforeEach(async () => {
  state.max = 2
  state.gate = new Promise<void>((resolve) => { state.release = resolve })
  vi.mocked(runFfmpegCancellable).mockClear()
  dir = await fs.mkdtemp(join(tmpdir(), "faststart-load-"))
})
afterEach(async () => {
  state.release?.()
  await fs.rm(dir, { recursive: true, force: true })
})
afterAll(() => vi.restoreAllMocks())

async function smallFile(name: string): Promise<string> {
  const path = join(dir, name)
  await fs.writeFile(path, smallMoovLast)
  return path
}

/** A moov-last MP4 that is `gib` GiB long on paper but sparse on disk: ftyp, a 64-bit-size mdat, then moov. */
async function sparseMoovLast(name: string, gib: number): Promise<{ path: string; size: number }> {
  const path = join(dir, name)
  const mdatSize = gib * GIB
  const mdatHead = Buffer.alloc(16)
  mdatHead.writeUInt32BE(1, 0)
  mdatHead.write("mdat", 4, "latin1")
  mdatHead.writeBigUInt64BE(BigInt(mdatSize), 8)
  const moov = box("moov", Buffer.alloc(32))
  const handle = await fs.open(path, "w")
  try {
    await handle.write(ftyp, 0, ftyp.length, 0)
    await handle.write(mdatHead, 0, 16, ftyp.length)
    await handle.write(moov, 0, moov.length, ftyp.length + mdatSize)
  } finally {
    await handle.close()
  }
  return { path, size: ftyp.length + mdatSize + moov.length }
}

describe("the file-lane concurrency cap", () => {
  it("runs two at once and stores the third as sent, with a warning", async () => {
    const paths = await Promise.all([smallFile("a.mp4"), smallFile("b.mp4"), smallFile("c.mp4")])
    const running = [faststartVideoFile(paths[0]!, "video/mp4"), faststartVideoFile(paths[1]!, "video/mp4")]
    await vi.waitFor(() => expect(faststartFileRemuxesInFlight()).toBe(2))
    await vi.waitFor(() => expect(runFfmpegCancellable).toHaveBeenCalledTimes(2))

    const third = await faststartVideoFile(paths[2]!, "video/mp4")
    expect(third).toMatchObject({ path: paths[2], outcome: "busy" })
    expect(runFfmpegCancellable).toHaveBeenCalledTimes(2)

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    noteFaststartOutcome("media-import", third.outcome, third.reason)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("busy"))
    warn.mockRestore()

    state.release?.()
    await Promise.all(running)
    expect(faststartFileRemuxesInFlight()).toBe(0)
  })

  it("gives the slot back when the remux ends, so the next one runs", async () => {
    const a = await smallFile("a.mp4")
    const b = await smallFile("b.mp4")
    state.max = 1
    const first = faststartVideoFile(a, "video/mp4")
    await vi.waitFor(() => expect(faststartFileRemuxesInFlight()).toBe(1))
    expect((await faststartVideoFile(b, "video/mp4")).outcome).toBe("busy")
    state.release?.()
    await first
    expect(faststartFileRemuxesInFlight()).toBe(0)

    state.gate = Promise.resolve()
    expect((await faststartVideoFile(b, "video/mp4")).outcome).toBe("failed") // ran (the launcher threw), not busy
  })

  it("follows the configured limit", async () => {
    state.max = 3
    const paths = await Promise.all(["a", "b", "c", "d"].map((n) => smallFile(`${n}.mp4`)))
    const running = paths.slice(0, 3).map((p) => faststartVideoFile(p, "video/mp4"))
    await vi.waitFor(() => expect(faststartFileRemuxesInFlight()).toBe(3))
    expect((await faststartVideoFile(paths[3]!, "video/mp4")).outcome).toBe("busy")
    state.release?.()
    await Promise.all(running)
  })

  it("a file that needs no remux never takes a slot", async () => {
    state.max = 1
    const fast = join(dir, "fast.mp4")
    await fs.writeFile(fast, Buffer.concat([ftyp, box("moov", Buffer.alloc(32)), box("mdat", Buffer.alloc(64))]))
    const a = await smallFile("a.mp4")
    const first = faststartVideoFile(a, "video/mp4")
    await vi.waitFor(() => expect(faststartFileRemuxesInFlight()).toBe(1))
    expect(await faststartVideoFile(fast, "video/mp4")).toEqual({ path: fast, outcome: "already-faststart" })
    state.release?.()
    await first
  })

  it("does not spend the file lane's slots on a buffered upload, nor the buffer lane's on an import", async () => {
    state.max = 1
    const a = await smallFile("a.mp4")
    const importing = faststartVideoFile(a, "video/mp4")
    await vi.waitFor(() => expect(faststartFileRemuxesInFlight()).toBe(1))
    // The file lane is full; a buffered upload is a different lane and still gets its own remux.
    const buffered = faststartVideoBuffer(smallMoovLast, "video/mp4")
    await vi.waitFor(() => expect(faststartBuffersInFlight()).toBe(1))
    await vi.waitFor(() => expect(runFfmpegCancellable).toHaveBeenCalledTimes(2))
    expect(faststartFileRemuxesInFlight()).toBe(1) // the buffered remux did not take a file slot
    state.release?.()
    await Promise.all([importing, buffered])
    expect(faststartFileRemuxesInFlight()).toBe(0)
    expect(faststartBuffersInFlight()).toBe(0)
  })
})

describe("the 2x free-disk rule", () => {
  it("refuses a file when free disk is under twice its size, even where the old margin check passed", async () => {
    state.gate = Promise.resolve()
    const { path, size } = await sparseMoovLast("big.mp4", 1)
    // Old rule needed 1.1 x size + 256 MB (about 1.4 GiB); 1.7 GiB passed it and fails the 2x rule.
    const free = Math.floor(1.7 * GIB)
    expect(free).toBeGreaterThan(Math.ceil(size * 1.1) + MARGIN)
    expect(free).toBeLessThan(2 * size)
    const result = await faststartVideoFile(path, "video/mp4", { freeBytes: async () => free })
    expect(result).toMatchObject({ path, outcome: "no-disk" })
    expect(result.reason).toContain("needed")
    expect(runFfmpegCancellable).not.toHaveBeenCalled()
  })

  it("remuxes when free disk covers twice the size plus the margin", async () => {
    state.gate = Promise.resolve()
    const { path, size } = await sparseMoovLast("big.mp4", 1)
    const free = 2 * size + MARGIN
    const result = await faststartVideoFile(path, "video/mp4", { freeBytes: async () => free })
    expect(result.outcome).not.toBe("no-disk")
    expect(runFfmpegCancellable).toHaveBeenCalledTimes(1)
    expect(faststartReservedDiskBytes()).toBe(0)
  })

  it("counts what a running remux has already promised toward the 2x", async () => {
    const one = await sparseMoovLast("one.mp4", 1)
    const two = await sparseMoovLast("two.mp4", 1)
    // Enough for one remux (2x + margin), not for two: the second sees the first's promise.
    const free = 2 * one.size + MARGIN + 1024
    const freeBytes = async () => free
    const first = faststartVideoFile(one.path, "video/mp4", { freeBytes })
    await vi.waitFor(() => expect(runFfmpegCancellable).toHaveBeenCalledTimes(1))
    expect(await faststartVideoFile(two.path, "video/mp4", { freeBytes })).toMatchObject({ outcome: "no-disk" })
    state.release?.()
    await first
    expect(faststartReservedDiskBytes()).toBe(0)
  })

  it("the buffered lane checks it too, before it writes the input copy", async () => {
    // 1 byte short of the buffered lane's own need would already stop it; a free value of
    // exactly the margin plus the two copies lets it through (the 2x floor is below that).
    state.gate = Promise.resolve()
    const need = Math.ceil(smallMoovLast.length * 2.1) + MARGIN
    const refused = await faststartVideoBuffer(smallMoovLast, "video/mp4", { freeBytes: async () => need - 1 })
    expect(refused.outcome).toBe("no-disk")
    const ok = await faststartVideoBuffer(smallMoovLast, "video/mp4", { freeBytes: async () => need + 8 })
    expect(ok.outcome).not.toBe("no-disk")
  })
})

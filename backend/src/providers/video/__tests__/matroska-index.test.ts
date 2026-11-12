// @test-reads-none reads only the files it makes with ffmpeg in a temp dir
/**
 * A Matroska file's stated Duration is relied on only when its muxer finished
 * the file — its SeekHead names a Cues index (decided 2026-11-12). Real ffmpeg
 * writes both kinds: a file it finishes, and a live one to a pipe (what a
 * browser recorder's output looks like).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { matroskaNamesItsIndex, onlyZeroBytesFrom } from "../matroska-index.js"
import { insertWebmDuration } from "./fixtures/media-edits.js"

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()
const TIMEOUT_MS = 30_000

describe("onlyZeroBytesFrom", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "zero-tail-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const file = async (name: string, bytes: Buffer) => {
    const f = join(dir, name)
    await writeFile(f, bytes)
    return f
  }

  it("true when every byte from the offset to the end is 0x00 — also across many read chunks", async () => {
    const f = await file("padded.bin", Buffer.concat([Buffer.alloc(1000, 0x42), Buffer.alloc(300_000)]))
    expect(await onlyZeroBytesFrom(f, 1000)).toBe(true)
    expect(await onlyZeroBytesFrom(f, 299_999)).toBe(true)
  })

  it("false when any byte after the offset is not zero, when the offset starts in the audio, or when nothing follows it", async () => {
    const tail = Buffer.alloc(200_000)
    tail[150_000] = 1
    const f = await file("not-padded.bin", Buffer.concat([Buffer.alloc(1000, 0x42), tail]))
    expect(await onlyZeroBytesFrom(f, 1000)).toBe(false)
    expect(await onlyZeroBytesFrom(f, 999)).toBe(false)
    expect(await onlyZeroBytesFrom(f, 201_000)).toBe(false)
    expect(await onlyZeroBytesFrom(f, -1)).toBe(false)
  })
})

describe.skipIf(!hasFfmpeg)("matroskaNamesItsIndex (real ffmpeg)", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "matroska-index-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** A 5 s FLAC-in-Matroska audio file, finished by ffmpeg, or written live to a pipe. */
  const mka = (name: string, live: boolean) => {
    const f = join(dir, name)
    const args = ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=5", "-c:a", "flac", "-f", "matroska"]
    if (!live) {
      execFileSync("ffmpeg", [...args, f], { stdio: "ignore" })
      return f
    }
    const fd = openSync(f, "w")
    try {
      execFileSync("ffmpeg", [...args, "pipe:1"], { stdio: ["ignore", fd, "ignore"] })
    } finally {
      closeSync(fd)
    }
    return f
  }

  it("a file ffmpeg finished names its index — and still does when cut off part-way", async () => {
    const whole = mka("whole.mka", false)
    expect(await matroskaNamesItsIndex(whole)).toBe(true)
    const bytes = await readFile(whole)
    const cut = join(dir, "cut.mka")
    await writeFile(cut, bytes.subarray(0, bytes.length >> 1))
    expect(await matroskaNamesItsIndex(cut)).toBe(true)
  }, TIMEOUT_MS)

  it("a file written live names none — nor does it once an app patches a Duration into it", async () => {
    const live = mka("live.mka", true)
    expect(await matroskaNamesItsIndex(live)).toBe(false)
    const patched = join(dir, "patched.mka")
    await writeFile(patched, insertWebmDuration(await readFile(live), 6000))
    expect(await matroskaNamesItsIndex(patched)).toBe(false)
  }, TIMEOUT_MS)
})

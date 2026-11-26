// @test-reads-none writes and reads only its own temp directory; reads no repo file
/**
 * `downloadFile` holds what it wrote to the length the server announced: a
 * body that ends early is refused (and its partial file removed), never handed
 * on as the whole file. Real streams and a real temp directory; only the SSRF
 * guard's fetch is replaced by a stub that answers with a constructed response.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"

const stub = vi.hoisted(() => ({ respond: undefined as undefined | (() => Response) }))

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: () => Promise.resolve(stub.respond!()),
}))

const { downloadFile, BIG_MEDIA_DOWNLOAD_LIMITS } = await import("../ffmpeg-utils.js")
const { DownloadIncompleteError, isDownloadIncompleteError } = await import("../../../lib/download-incomplete.js")

let dir = ""
beforeAll(async () => { dir = await fs.mkdtemp(join(tmpdir(), "download-length-")) })
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

/** A response whose headers say `headers` and whose body is `body`. */
function answer(body: Buffer, headers: Record<string, string>, status = 200): () => Response {
  return () => {
    const r = new Response(new Blob([new Uint8Array(body)]).stream(), { status })
    // A constructed Response sets no length of its own: give it the announced one.
    const h = new Headers(headers)
    Object.defineProperty(r, "headers", { value: h })
    return r
  }
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false)

describe("downloadFile checks the announced length", () => {
  it("refuses a body shorter than its Content-Length, removes the partial file, and drops the link's query from the message", async () => {
    const dest = join(dir, "short.bin")
    stub.respond = answer(Buffer.alloc(600, 1), { "content-length": "1000" })

    const err = await downloadFile("https://media.example/clip.mp4?sig=secret", dest).then(() => null, (e: Error) => e)

    expect(err).toBeInstanceOf(DownloadIncompleteError)
    expect(isDownloadIncompleteError(err)).toBe(true)
    expect(err?.message).toBe("Download incomplete: wrote 600 of the 1000 bytes announced: https://media.example/clip.mp4")
    // Not a timeout or a cap refusal: a failed read like any other.
    expect(err?.message).not.toMatch(/^Download (?:timeout|exceeds )/)
    expect(await exists(dest)).toBe(false)
  })

  it("on the big-media path too", async () => {
    const dest = join(dir, "short-big.bin")
    stub.respond = answer(Buffer.alloc(10, 1), { "content-length": "20" })

    await expect(downloadFile("https://media.example/camera.mov", dest, { limits: BIG_MEDIA_DOWNLOAD_LIMITS })).rejects.toBeInstanceOf(DownloadIncompleteError)
    expect(await exists(dest)).toBe(false)
  })

  it.each(["bytes 0-4/12", "bytes 7-11/12", "bytes 2-6/*"])("rejects a partial whole-file response (%s)", async (range) => {
    const dest = join(dir, "partial.bin")
    stub.respond = answer(Buffer.from("hello"), { "content-length": "5", "content-range": range }, 206)
    await expect(downloadFile("https://media.example/clip", dest)).rejects.toThrow(/incomplete/i)
    expect(await exists(dest)).toBe(false)
  })

  it("accepts a 206 covering the whole object", async () => {
    const dest = join(dir, "full-range.bin")
    stub.respond = answer(Buffer.from("hello"), { "content-length": "5", "content-range": "bytes 0-4/5" }, 206)
    await downloadFile("https://media.example/clip", dest)
    expect(await fs.readFile(dest, "utf8")).toBe("hello")
  })

  it("removes a file interrupted by a response body error and preserves its cause", async () => {
    const dest = join(dir, "interrupted.bin")
    const failure = new Error("connection terminated")
    stub.respond = () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5))
        setTimeout(() => controller.error(failure), 10)
      },
    }), { headers: { "content-length": "10" } })
    await expect(downloadFile("https://media.example/clip", dest)).rejects.toBe(failure)
    expect(await exists(dest)).toBe(false)
  })

  it("keeps an exact body as before", async () => {
    const dest = join(dir, "exact.bin")
    stub.respond = answer(Buffer.from("hello"), { "content-length": "5" })

    await downloadFile("https://media.example/ok.bin", dest)

    expect(await fs.readFile(dest, "utf8")).toBe("hello")
  })

  it("does not compare when no length is announced", async () => {
    const dest = join(dir, "unannounced.bin")
    stub.respond = answer(Buffer.from("hello"), {})

    await downloadFile("https://media.example/ok.bin", dest)

    expect(await fs.readFile(dest, "utf8")).toBe("hello")
  })

  it("does not compare an encoded body's length (the announced one is the compressed size)", async () => {
    const dest = join(dir, "encoded.bin")
    const decoded = Buffer.from("hello hello hello hello")
    // What arrives is the decoded body; the length is the gzip's.
    stub.respond = answer(decoded, { "content-length": String(gzipSync(decoded).length), "content-encoding": "gzip" })

    await downloadFile("https://media.example/ok.bin", dest)

    expect(await fs.readFile(dest, "utf8")).toBe("hello hello hello hello")
  })
})

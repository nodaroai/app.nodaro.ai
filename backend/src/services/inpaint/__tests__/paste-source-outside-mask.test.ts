/**
 * `pasteSourceOutsideMask`: fetches the source, the result and the mask, pastes
 * the source back outside the mask at the source's size, writes the file in
 * the result's own format and stores it in the job's scratch folder.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import sharp from "sharp"

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn(), scratch: vi.fn() }))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchBuffer: mocks.scratch }))

import { pasteSourceOutsideMask } from "../composite.js"
import { sniffImageFormat } from "../../../lib/image-output-store.js"

const N = 40
let source: Buffer
let mask: Buffer
const results: Record<string, Buffer> = {}

beforeAll(async () => {
  source = await sharp({ create: { width: N, height: N, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer()
  const raw = Buffer.alloc(N * N)
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) raw[y * N + x] = 255
  mask = await sharp(raw, { raw: { width: N, height: N, channels: 1 } }).png().toBuffer()
  // The model's picture: another size than the source, green all over.
  const green = sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 0, g: 255, b: 0 } } })
  results.png = await green.clone().png().toBuffer()
  results.jpeg = await green.clone().jpeg().toBuffer()
  results.webp = await green.clone().webp().toBuffer()
  results.gif = await green.clone().gif().toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scratch.mockResolvedValue("https://cdn.example.com/tmp/provider-input/job-1/mask-composite.png")
})

function serve(result: Buffer) {
  mocks.safeFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => (url.includes("source") ? source : url.includes("mask") ? mask : result),
  }))
}

const call = () => pasteSourceOutsideMask({ sourceUrl: "https://x/source.png", resultUrl: "https://x/result", maskUrl: "https://x/mask.png", jobId: "job-1" })

describe("pasteSourceOutsideMask", () => {
  for (const [format, ext, mime] of [["png", "png", "image/png"], ["jpeg", "jpg", "image/jpeg"], ["webp", "webp", "image/webp"]] as const) {
    it(`a ${format} result: stored as a ${format}, at the source's size, in the job's scratch folder`, async () => {
      serve(results[format]!)
      const url = await call()
      expect(url).toBe("https://cdn.example.com/tmp/provider-input/job-1/mask-composite.png")
      const [buffer, name, extension, contentType, jobId] = mocks.scratch.mock.calls[0]!
      expect([name, extension, contentType, jobId]).toEqual(["mask-composite", ext, mime, "job-1"])
      expect(sniffImageFormat(buffer)).toBe(format)
      const meta = await sharp(buffer).metadata()
      expect([meta.width, meta.height]).toEqual([N, N])
    })
  }

  it("outside the mask is the source, inside it the result (PNG: exactly)", async () => {
    serve(results.png!)
    await call()
    const [buffer] = mocks.scratch.mock.calls[0]!
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => [...data.subarray((y * N + x) * info.channels, (y * N + x) * info.channels + 3)]
    expect(at(2, 2)).toEqual([200, 40, 40])
    expect(at(9, 20)).toEqual([200, 40, 40]) // right next to the edge, outside
    expect(at(20, 20)).toEqual([0, 255, 0])
  })

  it("a result it cannot write (a GIF) is left as it is: nothing stored", async () => {
    serve(results.gif!)
    expect(await call()).toBeUndefined()
    expect(mocks.scratch).not.toHaveBeenCalled()
  })

  it("throws a plain Error when a picture cannot be fetched", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) })
    await expect(call()).rejects.toThrow("(404)")
  })
})

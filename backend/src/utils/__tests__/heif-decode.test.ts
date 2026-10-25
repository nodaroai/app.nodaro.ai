// @test-watches backend/src/utils/__tests__/fixtures/*.avif backend/src/utils/__tests__/fixtures/*.heic
import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import sharp from "sharp"
import { transcodeHeifForStorage, withHeifDecodeFallback } from "../heif-decode.js"

// Real sharp and the real ffmpeg on real files: the point is which decoder can
// read the pixels, so a stubbed decode would prove nothing. The fixtures are
// generated test patterns (96×64), small enough to commit:
//   10bit.avif        — 10-bit 4:2:0 AV1, the class a production Cast Swap
//                       upload died on (2026-10-25); sharp reads the header,
//                       not the pixels
//   10bit-irot90.avif — the same with an `irot` box (a quarter turn), as a
//                       phone writes a portrait photo: shown 64×96
//   hevc.heic         — HEVC, which sharp's prebuilt libheif cannot decode at all
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

const size = async (buffer: Buffer) => {
  const m = await sharp(buffer).metadata()
  return { format: m.format, width: m.width, height: m.height, hasAlpha: m.hasAlpha }
}

describe("the fixtures still reproduce sharp's gap", () => {
  it.each(["10bit.avif", "hevc.heic"])("sharp reads %s's header but cannot decode it", async (name) => {
    const buffer = fixture(name)
    expect((await sharp(buffer).metadata()).format).toBe("heif")
    await expect(sharp(buffer).png().toBuffer()).rejects.toThrow(/heif/)
  })
})

describe("transcodeHeifForStorage", () => {
  it("stores a 10-bit AVIF as a JPEG of the same picture", async () => {
    const out = await transcodeHeifForStorage(fixture("10bit.avif"))
    expect(out.mime).toBe("image/jpeg")
    expect(out.ext).toBe("jpg")
    expect(await size(out.buffer)).toMatchObject({ format: "jpeg", width: 96, height: 64 })
  })

  it("stores a HEIC as a JPEG of the same picture", async () => {
    const out = await transcodeHeifForStorage(fixture("hevc.heic"))
    expect(out.mime).toBe("image/jpeg")
    expect(await size(out.buffer)).toMatchObject({ format: "jpeg", width: 96, height: 64 })
  })

  it("applies the file's irot on the ffmpeg path, as libheif does", async () => {
    const out = await transcodeHeifForStorage(fixture("10bit-irot90.avif"))
    expect(await size(out.buffer)).toMatchObject({ width: 64, height: 96 })
  })

  it("keeps an 8-bit AVIF's transparency (sharp decodes it; stored as PNG)", async () => {
    const avif = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
      .avif()
      .toBuffer()
    const out = await transcodeHeifForStorage(avif)
    expect(out.mime).toBe("image/png")
    expect(out.ext).toBe("png")
    expect(await size(out.buffer)).toMatchObject({ format: "png", hasAlpha: true })
  })
})

describe("withHeifDecodeFallback", () => {
  it("never asks ffmpeg when the caller's work succeeds", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer()
    const seen: Buffer[] = []
    const result = await withHeifDecodeFallback(png, async (input) => {
      seen.push(input)
      return "ok"
    })
    expect(result).toBe("ok")
    expect(seen).toEqual([png])
  })

  it("rethrows the caller's own error for an input that is not HEIF", async () => {
    const notHeif = Buffer.from("definitely not an image")
    await expect(
      withHeifDecodeFallback(notHeif, async () => {
        throw new Error("caller failed")
      }),
    ).rejects.toThrow("caller failed")
  })
})

describe("decodeHeifWithFfmpeg refuses a partial decode", () => {
  afterEach(() => {
    vi.doUnmock("../../providers/video/ffmpeg-utils.js")
    vi.resetModules()
  })

  it("throws when ffmpeg's picture is not the size the file declares (one tile, a thumbnail)", async () => {
    vi.resetModules()
    vi.doMock("../../providers/video/ffmpeg-utils.js", () => ({
      runFfmpeg: async (args: readonly string[]) => {
        const { writeFile } = await import("node:fs/promises")
        const tile = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } }).png().toBuffer()
        await writeFile(args[args.length - 1]!, tile)
        return ""
      },
    }))
    const { decodeHeifWithFfmpeg: decode } = await import("../heif-decode.js")
    await expect(decode(fixture("10bit.avif"))).rejects.toThrow(/32×32.*96×64/)
  })
})

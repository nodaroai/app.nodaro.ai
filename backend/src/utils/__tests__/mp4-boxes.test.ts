import { describe, it, expect } from "vitest"
import { probeMp4Layout, probeMp4LayoutInBuffer } from "../mp4-boxes.js"

/** A box with a 32-bit size. */
function box(type: string, payload: Buffer | number = 0): Buffer {
  const body = typeof payload === "number" ? Buffer.alloc(payload) : payload
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + body.length, 0)
  header.write(type, 4, "latin1")
  return Buffer.concat([header, body])
}

/** A box with a 64-bit `largesize` (size field = 1). */
function largeBox(type: string, payloadBytes: number): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(1, 0)
  header.write(type, 4, "latin1")
  header.writeBigUInt64BE(BigInt(16 + payloadBytes), 8)
  return Buffer.concat([header, Buffer.alloc(payloadBytes)])
}

function ftyp(brand = "isom"): Buffer {
  return box("ftyp", Buffer.concat([Buffer.from(brand, "latin1"), Buffer.alloc(4), Buffer.from("isomiso2", "latin1")]))
}

describe("probeMp4Layout", () => {
  it("faststart: moov before mdat", async () => {
    const probe = await probeMp4LayoutInBuffer(Buffer.concat([ftyp(), box("moov", 64), box("mdat", 4096)]))
    expect(probe.layout).toBe("faststart")
  })

  it("moov at the end: mdat before moov", async () => {
    const probe = await probeMp4LayoutInBuffer(Buffer.concat([ftyp(), box("mdat", 4096), box("moov", 64)]))
    expect(probe.layout).toBe("moov-last")
  })

  it("reads the major brand from ftyp", async () => {
    expect((await probeMp4LayoutInBuffer(Buffer.concat([ftyp("qt  "), box("mdat", 16), box("moov", 16)]))).majorBrand).toBe("qt  ")
    expect((await probeMp4LayoutInBuffer(Buffer.concat([ftyp("mp42"), box("moov", 16), box("mdat", 16)]))).majorBrand).toBe("mp42")
  })

  it("skips free / wide / skip boxes ahead of the decisive one", async () => {
    const file = Buffer.concat([ftyp(), box("free", 32), box("wide", 0), box("skip", 8), box("mdat", 128), box("free", 8), box("moov", 32)])
    expect((await probeMp4LayoutInBuffer(file)).layout).toBe("moov-last")
    const early = Buffer.concat([ftyp(), box("free", 32), box("moov", 32), box("mdat", 128)])
    expect((await probeMp4LayoutInBuffer(early)).layout).toBe("faststart")
  })

  it("follows a 64-bit largesize mdat to find a trailing moov", async () => {
    const file = Buffer.concat([ftyp(), largeBox("mdat", 1024), box("moov", 40)])
    expect((await probeMp4LayoutInBuffer(file)).layout).toBe("moov-last")
  })

  it("a fragmented MP4 (moof) is never a remux candidate", async () => {
    const fragmented = Buffer.concat([ftyp(), box("moov", 40), box("moof", 40), box("mdat", 64)])
    // moov precedes everything here, so it is already stream-friendly...
    expect((await probeMp4LayoutInBuffer(fragmented)).layout).toBe("faststart")
    // ...and a moof before any moov is reported as fragmented, not as moov-last.
    const moofFirst = Buffer.concat([ftyp(), box("styp", 8), box("moof", 40), box("mdat", 64)])
    expect((await probeMp4LayoutInBuffer(moofFirst)).layout).toBe("fragmented")
    const moofAfterMdat = Buffer.concat([ftyp(), box("mdat", 64), box("moof", 40), box("mdat", 64)])
    expect((await probeMp4LayoutInBuffer(moofAfterMdat)).layout).toBe("fragmented")
  })

  it("size 0 (box runs to end of file) leaves no room for a moov: unknown", async () => {
    const header = Buffer.alloc(8)
    header.write("mdat", 4, "latin1")
    const file = Buffer.concat([ftyp(), header, Buffer.alloc(256)])
    expect((await probeMp4LayoutInBuffer(file)).layout).toBe("unknown")
  })

  it("not ISO-BMFF at all: unknown", async () => {
    expect((await probeMp4LayoutInBuffer(Buffer.from("RIFF....AVI LIST", "latin1"))).layout).toBe("unknown")
    // EBML (WebM / Matroska)
    expect((await probeMp4LayoutInBuffer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f]))).layout).toBe("unknown")
    expect((await probeMp4LayoutInBuffer(Buffer.alloc(0))).layout).toBe("unknown")
    expect((await probeMp4LayoutInBuffer(Buffer.alloc(7))).layout).toBe("unknown")
  })

  it("a truncated file (a box running past the end) or an ftyp-only file: unknown", async () => {
    const truncated = Buffer.concat([ftyp(), box("mdat", 4096)]).subarray(0, 600)
    expect((await probeMp4LayoutInBuffer(truncated)).layout).toBe("unknown")
    expect((await probeMp4LayoutInBuffer(ftyp())).layout).toBe("unknown")
    // mdat but the moov never arrives
    expect((await probeMp4LayoutInBuffer(Buffer.concat([ftyp(), box("mdat", 64)]))).layout).toBe("unknown")
  })

  it("a box smaller than its own header stops the walk instead of looping", async () => {
    const bad = Buffer.alloc(8)
    bad.writeUInt32BE(4, 0)
    bad.write("junk", 4, "latin1")
    expect((await probeMp4LayoutInBuffer(Buffer.concat([ftyp(), bad, box("moov", 8)]))).layout).toBe("unknown")
  })

  it("touches only box headers: never a media payload", async () => {
    // A 3 GB virtual file: ftyp, a 3 GB mdat, then moov. The reader only ever sees 16-byte reads.
    const head = ftyp()
    const mdatSize = 3 * 1024 ** 3
    const moov = box("moov", 100)
    const mdatHeader = Buffer.alloc(16)
    mdatHeader.writeUInt32BE(1, 0)
    mdatHeader.write("mdat", 4, "latin1")
    mdatHeader.writeBigUInt64BE(BigInt(mdatSize), 8)
    const total = head.length + mdatSize + moov.length
    const reads: Array<[number, number]> = []
    const probe = await probeMp4Layout(async (offset, length) => {
      reads.push([offset, length])
      if (offset === 0) return Buffer.concat([head, mdatHeader]).subarray(0, length)
      if (offset === head.length) return mdatHeader.subarray(0, length)
      if (offset === head.length + mdatSize) return moov.subarray(0, length)
      return Buffer.alloc(0)
    }, total)
    expect(probe.layout).toBe("moov-last")
    expect(reads.length).toBeLessThanOrEqual(4)
    expect(Math.max(...reads.map(([, length]) => length))).toBeLessThanOrEqual(16)
  })
})

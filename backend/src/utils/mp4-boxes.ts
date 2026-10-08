/**
 * Where an MP4 / MOV file keeps its index (the `moov` box), read from the
 * top-level boxes alone.
 *
 * An ISO-BMFF file is a flat list of boxes: `size` (u32 BE) + `type` (4 ASCII
 * bytes), then the payload. `size == 1` means a 64-bit `largesize` follows the
 * type (16-byte header); `size == 0` means "to the end of the file". The walk
 * therefore touches a few bytes per top-level box and never the media payload,
 * so it is cheap on a multi-gigabyte file.
 *
 * A player must read `moov` before it can seek. With `moov` AFTER `mdat` (an
 * OBS or phone recording that was finalised at the end) the first seek has to
 * fetch the tail of the file first; with `moov` BEFORE `mdat` ("faststart") the
 * index arrives with the first bytes.
 */

export type Mp4Layout =
  /** `moov` precedes the first `mdat`: nothing to do. */
  | "faststart"
  /** `mdat` precedes `moov`: the index is at the end. The only layout worth remuxing. */
  | "moov-last"
  /** A `moof` fragment is present: a fragmented MP4 is built to stream, and `+faststart` is meaningless for it. */
  | "fragmented"
  /** Not recognisable ISO-BMFF, truncated, or no `moov`/`mdat` pair found. Left alone. */
  | "unknown"

export interface Mp4Probe {
  readonly layout: Mp4Layout
  /** The `ftyp` major brand ("isom", "mp42", "qt  ", ...), when present. */
  readonly majorBrand?: string
}

/** Top-level box types an MP4/MOV may open with. A file whose FIRST box is none of these is not ours. */
const KNOWN_LEAD_BOXES = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot", "styp", "uuid"])

/** Safety bound on the walk: a real file has a handful of top-level boxes. */
const MAX_BOXES = 10_000

/** A reader of `length` bytes at `offset`; returns fewer (or none) at end of file. */
export type RangeReader = (offset: number, length: number) => Promise<Buffer>

/** Walk the top-level boxes through `read`, `fileSize` bytes long. */
export async function probeMp4Layout(read: RangeReader, fileSize: number): Promise<Mp4Probe> {
  let offset = 0
  let sawMdat = false
  let majorBrand: string | undefined
  let first = true

  for (let n = 0; n < MAX_BOXES && offset + 8 <= fileSize; n++) {
    const header = await read(offset, 16)
    if (header.length < 8) return { layout: "unknown", majorBrand }

    let size = header.readUInt32BE(0)
    const type = header.toString("latin1", 4, 8)

    if (first) {
      if (!KNOWN_LEAD_BOXES.has(type)) return { layout: "unknown" }
      first = false
    }

    if (type === "ftyp" && majorBrand === undefined && header.length >= 12) {
      majorBrand = header.toString("latin1", 8, 12)
    }

    if (type === "moof") return { layout: "fragmented", majorBrand }
    if (type === "moov") return { layout: sawMdat ? "moov-last" : "faststart", majorBrand }
    if (type === "mdat") sawMdat = true

    if (size === 1) {
      if (header.length < 16) return { layout: "unknown", majorBrand }
      const large = header.readBigUInt64BE(8)
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return { layout: "unknown", majorBrand }
      size = Number(large)
    } else if (size === 0) {
      // "Extends to the end of the file": nothing can follow, so no moov after this box.
      return { layout: "unknown", majorBrand }
    }

    // A box smaller than its own header, or one that runs past the end, is
    // corrupt or truncated; never walk on through garbage.
    if (size < 8 || offset + size > fileSize) return { layout: "unknown", majorBrand }
    offset += size
  }

  return { layout: "unknown", majorBrand }
}

/** {@link probeMp4Layout} over a Buffer already in memory. */
export function probeMp4LayoutInBuffer(buffer: Buffer): Promise<Mp4Probe> {
  return probeMp4Layout(
    async (offset, length) => buffer.subarray(offset, Math.min(buffer.length, offset + length)),
    buffer.length,
  )
}

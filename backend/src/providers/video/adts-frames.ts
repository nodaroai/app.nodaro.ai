// @reads-none reads only the downloaded audio file its caller hands it (a work-dir path), never a repo file
/**
 * The stray bytes at the end of an ADTS AAC file (decided 2026-11-12) — what
 * lets the lane tell "ffmpeg stopped part-way through the file" from "ffmpeg
 * decoded every frame and then tripped over a few leftover bytes".
 *
 * ffmpeg's ADTS demuxer (`libavformat/aacdec.c`) reads each frame as a 7-byte
 * header and then the frame. After the last frame, FEWER THAN 10 bytes left
 * over (a few stray bytes, or a cut inside the next header) make it stop with
 * "Error during demuxing" — it needs 7 bytes for a header and 3 more to look
 * for an ID3 tag — while 10 or more non-frame bytes are skipped as junk and
 * the file simply ends. Those few bytes can hold no audio (a frame is a 7-byte
 * header and its payload), so a file whose frames run back to back from the
 * first to within those bytes of the end decoded completely.
 *
 * Followed the way the demuxer reads it: ID3v2 tags before the first frame
 * and between frames are skipped, the first frame is the first sync word.
 * Anything else — junk between frames, a frame cut off part-way, an invalid
 * header with 10 bytes or more after it — and the answer is undefined.
 *
 * Read in bounded chunks: the file can be up to the lane's 100 MB source cap.
 */
import { open, type FileHandle } from "node:fs/promises"

const ADTS_HEADER_BYTES = 7
const ID3V2_HEADER_BYTES = 10

/** Fewer bytes than this after the last frame, and the demuxer stops with an error instead of ending. */
export const ADTS_DEMUX_TAIL_BYTES = ID3V2_HEADER_BYTES

/** How far into the file the first sync word is looked for (ffmpeg's default probe size). */
const FIRST_SYNC_SEARCH_BYTES = 5_000_000

const CHUNK_BYTES = 1 << 16

/** Positioned reads through one buffered window. */
class Window {
  private buf = Buffer.alloc(0)
  private start = 0
  constructor(private readonly fh: FileHandle, readonly size: number) {}

  /** The first position in [from, end) where a sync word starts, or undefined. */
  async findSync(from: number, end: number): Promise<number | undefined> {
    for (let pos = from; pos < end; ) {
      await this.load(pos)
      const last = Math.min(end, this.start + this.buf.length - 1)
      for (; pos < last; pos++) if (isSync(this.buf[pos - this.start]!, this.buf[pos - this.start + 1]!)) return pos
      if (this.start + this.buf.length >= this.size) return undefined
    }
    return undefined
  }

  /** `n` bytes from `pos` (pos + n <= size, n far under a chunk). */
  async bytes(pos: number, n: number): Promise<Buffer> {
    if (pos < this.start || pos + n > this.start + this.buf.length) await this.load(pos)
    return this.buf.subarray(pos - this.start, pos - this.start + n)
  }

  private async load(pos: number): Promise<void> {
    const length = Math.min(CHUNK_BYTES, this.size - pos)
    const buf = Buffer.alloc(length)
    const { bytesRead } = await this.fh.read(buf, 0, length, pos)
    this.buf = buf.subarray(0, bytesRead)
    this.start = pos
  }
}

const isSync = (b0: number, b1: number) => b0 === 0xff && (b1 & 0xf0) === 0xf0

/** The length of the ID3v2 tag at `pos` (header, body and footer), or undefined when there is none. */
async function id3v2Length(w: Window, pos: number): Promise<number | undefined> {
  if (w.size - pos < ID3V2_HEADER_BYTES) return undefined
  const h = await w.bytes(pos, ID3V2_HEADER_BYTES)
  if (h.toString("latin1", 0, 3) !== "ID3" || h[3] === 0xff || h[4] === 0xff) return undefined
  if ((h[6]! | h[7]! | h[8]! | h[9]!) & 0x80) return undefined
  const body = (h[6]! << 21) | (h[7]! << 14) | (h[8]! << 7) | h[9]!
  return ID3V2_HEADER_BYTES + body + (h[5]! & 0x10 ? ID3V2_HEADER_BYTES : 0)
}

/**
 * How many bytes follow the last complete frame of the ADTS file at `path`,
 * when its frames run back to back from the first to within fewer than
 * `ADTS_DEMUX_TAIL_BYTES` of the end (0 to 9). Undefined otherwise.
 */
export async function adtsStrayTailBytes(path: string): Promise<number | undefined> {
  const fh = await open(path, "r")
  try {
    const w = new Window(fh, (await fh.stat()).size)
    let pos = 0
    for (let tag = await id3v2Length(w, pos); tag !== undefined; tag = await id3v2Length(w, pos)) pos += tag
    // The first frame: the first sync word.
    const first = await w.findSync(pos, Math.min(w.size - 1, pos + FIRST_SYNC_SEARCH_BYTES))
    if (first === undefined) return undefined
    pos = first
    let frames = 0
    for (;;) {
      const left = w.size - pos
      if (left < 0) return undefined
      if (left < ADTS_HEADER_BYTES) return frames > 0 ? left : undefined
      const h = await w.bytes(pos, ADTS_HEADER_BYTES)
      if (isSync(h[0]!, h[1]!)) {
        const frameBytes = ((h[3]! & 0x03) << 11) | (h[4]! << 3) | (h[5]! >> 5)
        if (frameBytes < ADTS_HEADER_BYTES) return frames > 0 && left < ADTS_DEMUX_TAIL_BYTES ? left : undefined
        if (frameBytes > left) return undefined
        pos += frameBytes
        frames++
        continue
      }
      const tag = await id3v2Length(w, pos)
      if (tag !== undefined) {
        pos += tag
        continue
      }
      return frames > 0 && left < ADTS_DEMUX_TAIL_BYTES ? left : undefined
    }
  } finally {
    await fh.close()
  }
}

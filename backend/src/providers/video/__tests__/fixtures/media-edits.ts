/**
 * Byte edits that make an honest media file damaged or lying, the same way on
 * every ffmpeg build (they target the container's own structure, never a byte
 * offset that depends on how an encoder laid the file out).
 */

/**
 * A Matroska file with its `k`th Cluster (0-based) damaged: 32 bytes of 0x55
 * over the start of its first element. ffmpeg's demuxer skips to the next
 * Cluster, so that cluster's audio is lost, and no error is logged.
 */
export function damageCluster(mkv: Buffer, k: number): Buffer {
  const out = Buffer.from(mkv)
  const id = Buffer.from([0x1f, 0x43, 0xb6, 0x75])
  let at = -1
  for (let i = 0; i <= k; i++) at = out.indexOf(id, at + 1)
  if (at < 0) throw new Error(`media-edits: no cluster ${k}`)
  // An EBML size's length is its first byte's leading zero bits + 1.
  const sizeBytes = Math.clz32(out[at + 4]!) - 23
  out.fill(0x55, at + 4 + sizeBytes, at + 4 + sizeBytes + 32)
  return out
}

/** An EBML element size of `width` bytes (the width its first byte's marker bit sets). */
function ebmlSize(value: number, width: number): Buffer {
  const out = Buffer.alloc(width)
  let v = value
  for (let i = width - 1; i >= 0; i--) {
    out[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  out[0] = out[0]! | (0x80 >> (width - 1))
  return out
}

/**
 * A live WebM (no Duration, as a browser's recorder writes it) given a
 * Segment Info Duration of `ms`, the way an app patches one in after
 * recording: an 8-byte float Duration element inserted at the start of Info,
 * Info's size grown to hold it. Nothing else is rewritten.
 */
export function insertWebmDuration(webm: Buffer, ms: number): Buffer {
  const infoId = Buffer.from([0x15, 0x49, 0xa9, 0x66])
  // The Info element itself, not a SeekHead entry naming it (SeekID 0x53AB, 4 bytes, then the ID).
  let info = webm.indexOf(infoId)
  while (info >= 3 && webm[info - 3] === 0x53 && webm[info - 2] === 0xab && webm[info - 1] === 0x84) info = webm.indexOf(infoId, info + 1)
  if (info < 0) throw new Error("media-edits: no Info element")
  const at = info + 4
  const width = Math.clz32(webm[at]!) - 23
  let size = webm[at]! & ((0x80 >> (width - 1)) - 1)
  for (let i = 1; i < width; i++) size = size * 256 + webm[at + i]!
  const duration = Buffer.alloc(11)
  duration.set([0x44, 0x89, 0x88])
  duration.writeDoubleBE(ms, 3)
  return Buffer.concat([webm.subarray(0, at), ebmlSize(size + duration.length, width), duration, webm.subarray(at + width)])
}

/** The CRC an Ogg page carries (polynomial 0x04C11DB7, no reflection), over the page with its CRC field zeroed. */
function oggCrc(page: Buffer): number {
  let crc = 0
  for (const byte of page) {
    crc ^= byte << 24
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
  }
  return crc >>> 0
}

/** An Ogg Opus file whose OpusHead states a pre-skip of `samples` (48 kHz), its first page's CRC fixed to match. */
export function setOpusPreSkip(ogg: Buffer, samples: number): Buffer {
  const out = Buffer.from(ogg)
  if (out.toString("latin1", 0, 4) !== "OggS") throw new Error("media-edits: not an Ogg file")
  const head = out.indexOf("OpusHead")
  if (head < 0) throw new Error("media-edits: no OpusHead")
  out.writeUInt16LE(samples, head + 10)
  const segments = out[26]!
  let pageLength = 27 + segments
  for (let i = 0; i < segments; i++) pageLength += out[27 + i]!
  out.writeUInt32LE(0, 22)
  out.writeUInt32LE(oggCrc(out.subarray(0, pageLength)), 22)
  return out
}

/** A FLAC whose STREAMINFO states `factor` × the samples it holds (0: states no count). */
export function restateFlac(flac: Buffer, factor: number): Buffer {
  const out = Buffer.from(flac)
  if (out.toString("latin1", 0, 4) !== "fLaC") throw new Error("media-edits: not a FLAC")
  // "fLaC", the STREAMINFO block header, then the total samples: the low 36 bits of body bytes 13-17.
  const b = 8
  const total = (out[b + 13]! & 0x0f) * 2 ** 32 + out.readUInt32BE(b + 14)
  const n = Math.round(total * factor)
  out[b + 13] = (out[b + 13]! & 0xf0) | Math.floor(n / 2 ** 32)
  out.writeUInt32BE(n % 2 ** 32, b + 14)
  return out
}

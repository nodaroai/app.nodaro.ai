/**
 * What a file is stored as, from its first bytes — never the remote server's
 * word for it nor the link's name. Pure (no I/O, no config), so a pre-hold
 * check can read it without loading the outside-input lane (moved here from
 * `outside-input-copy.ts`, which re-exports it, decided 2026-11-24).
 */

/** The kind of file a lane expects. */
export type SniffKind = "image" | "video" | "audio"


/** ISO-BMFF brands of a still image (AVIF, HEIF): every other `ftyp` brand is an audio-or-video container. */
const AVIF_BRANDS = new Set(["avif", "avis"])
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])
/** A QuickTime file whose first box is not `ftyp`: the box types it can start with. */
const QUICKTIME_FIRST_BOXES = new Set(["wide", "free", "skip", "mdat", "moov"])

/**
 * What a file of `kind` is stored as, from its first bytes (never the remote
 * server's word for it), or undefined when its first bytes show no format of
 * that kind listed here (the lane's `inspect` decides the rest: a listed
 * format can still be refused there).
 *
 * A container that holds sound or pictures alike (ISO-BMFF with any brand that
 * is not an image's, WebM / Matroska, Ogg) is taken for either `audio` or
 * `video`, typed by the kind asked for: the lane's stream probe decides
 * whether it really has what the lane needs.
 */
export function sniffInputType(head: Buffer, kind: SniffKind): { readonly ext: string; readonly contentType: string } | undefined {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString("latin1")
  const audio = kind === "audio"
  const video = kind === "video"
  const image = kind === "image"
  if (head.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12)
    if (AVIF_BRANDS.has(brand)) return image ? { ext: "avif", contentType: "image/avif" } : undefined
    if (HEIF_BRANDS.has(brand)) return image ? { ext: "heic", contentType: "image/heic" } : undefined
    if (audio) return { ext: "m4a", contentType: "audio/mp4" }
    if (video) return brand === "qt  " ? { ext: "mov", contentType: "video/quicktime" } : { ext: "mp4", contentType: "video/mp4" }
    return undefined
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
    return audio ? { ext: "webm", contentType: "audio/webm" } : video ? { ext: "webm", contentType: "video/webm" } : undefined
  }
  if (head.length >= 4 && ascii(0, 4) === "OggS") {
    return audio ? { ext: "ogg", contentType: "audio/ogg" } : video ? { ext: "ogv", contentType: "video/ogg" } : undefined
  }
  if (head.length >= 12 && ascii(8, 12) === "WAVE" && ["RIFF", "RF64", "BW64"].includes(ascii(0, 4))) {
    return audio ? { ext: "wav", contentType: "audio/wav" } : undefined
  }
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return video ? { ext: "avi", contentType: "video/x-msvideo" } : undefined
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return image ? { ext: "webp", contentType: "image/webp" } : undefined
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return image ? { ext: "png", contentType: "image/png" } : undefined
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return image ? { ext: "jpg", contentType: "image/jpeg" } : undefined
  if (head.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return image ? { ext: "gif", contentType: "image/gif" } : undefined
  if (head.length >= 4 && (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*")) return image ? { ext: "tiff", contentType: "image/tiff" } : undefined
  if (head.length >= 2 && ascii(0, 2) === "BM") return image ? { ext: "bmp", contentType: "image/bmp" } : undefined
  if (head.length >= 4 && ascii(0, 4) === "fLaC") return audio ? { ext: "flac", contentType: "audio/flac" } : undefined
  if (head.length >= 3 && ascii(0, 3) === "ID3") return audio ? { ext: "mp3", contentType: "audio/mpeg" } : undefined
  // An MPEG audio frame's sync: layer bits 00 are ADTS (AAC), anything else an MP3 frame.
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xf0) === 0xf0 && (head[1]! & 0x06) === 0) {
    return audio ? { ext: "aac", contentType: "audio/aac" } : undefined
  }
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return audio ? { ext: "mp3", contentType: "audio/mpeg" } : undefined
  // Last: a QuickTime file whose first box is not `ftyp` (only a box type marks it).
  if (head.length >= 8 && QUICKTIME_FIRST_BOXES.has(ascii(4, 8))) return video ? { ext: "mov", contentType: "video/quicktime" } : undefined
  return undefined
}

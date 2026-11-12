// @reads-none reads only the downloaded audio file its caller hands it (a work-dir path), never a repo file
/**
 * Two reads of a caller's Matroska/WebM file's bytes (decided 2026-11-12):
 * whether its muxer finished it (`matroskaNamesItsIndex`), and whether the
 * damage its demuxer reports is only zero padding after the audio
 * (`onlyZeroBytesFrom`).
 *
 * Was a Matroska/WebM file finalized by its muxer? Only
 * then is the Duration it states the length of its media.
 *
 * A muxer that finishes a file writes its index (Cues) and names it in the
 * SeekHead at the front of the Segment — ffmpeg, mkvmerge, OBS's recordings.
 * A recorder that streams (a browser's MediaRecorder, a live mux to a pipe)
 * writes neither, and an app that patches a Duration into such a file
 * afterwards (the "fix-webm-duration" pattern) writes the wall-clock time it
 * recorded, pauses included — a length its audio never had. A finalized file
 * cut off later keeps its SeekHead, which sits at the front.
 *
 * Either way this is wrong — an index named by a second SeekHead further in,
 * an unusual size encoding — the answer is "not finalized": the stated
 * length is then not used, which can only refuse fewer files.
 */
import { open } from "node:fs/promises"

/** How much of the file's start is read: the EBML header, the Segment header and its SeekHead. */
const HEAD_BYTES = 64 * 1024

/** A SeekHead entry's SeekID (0x53AB, 4 bytes long) holding the Cues element's ID (0x1C53BB6B). */
const SEEK_ID_CUES = Buffer.from([0x53, 0xab, 0x84, 0x1c, 0x53, 0xbb, 0x6b])

/** Does the SeekHead at the start of the Matroska file at `path` name a Cues index? */
export async function matroskaNamesItsIndex(path: string): Promise<boolean> {
  const fh = await open(path, "r")
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(head, 0, HEAD_BYTES, 0)
    return head.subarray(0, bytesRead).includes(SEEK_ID_CUES)
  } finally {
    await fh.close()
  }
}

/** How much is read at a time when scanning a file's tail. */
const TAIL_CHUNK_BYTES = 64 * 1024

/**
 * Is every byte of the file at `path` from `offset` to its end 0x00 (and is
 * there at least one)? A recording recovered after a crash, or written into
 * space reserved ahead, ends in zero padding after its last cluster; the
 * Matroska demuxer reports it as an invalid element and stops — after all
 * the audio has decoded (decided 2026-11-12). Read in bounded chunks, stopped
 * at the first byte that is not zero.
 */
export async function onlyZeroBytesFrom(path: string, offset: number): Promise<boolean> {
  const fh = await open(path, "r")
  try {
    const { size } = await fh.stat()
    if (!Number.isInteger(offset) || offset < 0 || offset >= size) return false
    const chunk = Buffer.alloc(TAIL_CHUNK_BYTES)
    for (let at = offset; at < size; ) {
      const { bytesRead } = await fh.read(chunk, 0, Math.min(TAIL_CHUNK_BYTES, size - at), at)
      if (bytesRead <= 0) return false
      for (let i = 0; i < bytesRead; i++) if (chunk[i] !== 0) return false
      at += bytesRead
    }
    return true
  } finally {
    await fh.close()
  }
}

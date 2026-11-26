import { createWriteStream } from "node:fs"
import { rm } from "node:fs/promises"
import type { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * A download whose body did not match the length its source announced
 * (`Content-Length` of an unencoded HTTP response, `ContentLength` of a
 * storage read). Thrown by `downloadFile` (providers/video/ffmpeg-utils.ts)
 * and `downloadR2ObjectToFile` (lib/storage.ts) after removing the partial
 * file, so a short file is never handed to a caller.
 *
 * Deliberately NOT a timeout ("Download timeout…") or a size-cap refusal
 * ("Download exceeds…"), and not a `DeterministicJobError`: a failed read like
 * any other — a storage read that ends short is followed by the link, and a
 * job that fails on one is retried as for any failed read.
 */
export class DownloadIncompleteError extends Error {
  constructor(reason: string) {
    super(`Download incomplete: ${reason}`)
    this.name = "DownloadIncompleteError"
  }
}

/** Whether `err` is a {@link DownloadIncompleteError} (by name too, should its prototype be lost). */
export function isDownloadIncompleteError(err: unknown): boolean {
  return err instanceof DownloadIncompleteError || (err instanceof Error && err.name === "DownloadIncompleteError")
}

/** The byte count comes from the destination after the writer closes. Remove
 * only files we actually opened, preserving the read, write or abort error. */
export async function writeDownloadToFile(
  source: Readable,
  dest: string,
  transforms: Transform[],
  expected: number | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  const file = createWriteStream(dest)
  let opened = false
  file.once("open", () => { opened = true })
  try {
    await pipeline([source, ...transforms, file], { signal })
    if (expected !== undefined && file.bytesWritten !== expected) {
      throw new DownloadIncompleteError(`wrote ${file.bytesWritten} of the ${expected} bytes announced: ${label}`)
    }
  } catch (err) {
    if (opened) await rm(dest, { force: true }).catch(() => undefined)
    throw err
  }
}

// @reads-none reads only the video copy it downloads to the OS temp dir
/**
 * The bytes a share card's picture is drawn from (render.ts).
 *
 * Our own files are read from the bucket by their key, never through the CDN
 * (a premature CDN read can keep a 404 for a year). Another host's file (a
 * provider's song art) is fetched with the public-download checks
 * (`safeFetchBytes`: no private network, a byte cap, a timeout), and only an
 * https address the card itself may name ever reaches here (card.ts refuses a
 * restricted one first). A video with no poster of ours gives its first frame,
 * taken by the pinned ffmpeg from our own copy, within a size cap. Every
 * failure reads as "no picture": the card then draws the brand's tile.
 */
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { config } from "../../config.js"
import { r2KeyFromPublicUrl } from "../../r2-public-key.js"
import { readR2Object, downloadR2ObjectToFile } from "../../storage.js"
import { safeFetchBytes } from "../../safe-fetch-bytes.js"
import { thumbnailFromLocalVideo } from "../../../utils/thumbnail.js"
import type { LoadedPicture } from "./render.js"
import { GRID_MAX, type CardPicture } from "./plan.js"

/** The most a picture source may weigh. */
export const SOURCE_IMAGE_MAX_BYTES = 20 * 1024 * 1024
/** The largest video a frame is taken from. */
export const SOURCE_VIDEO_MAX_BYTES = 200 * 1024 * 1024
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000

/** The bucket key of one of our files, or null for another host's. */
export function ownKeyOf(url: string): string | null {
  return r2KeyFromPublicUrl(url, config.R2_PUBLIC_URL)
}

/** A picture's bytes, or null. */
export async function loadImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null
  try {
    const key = ownKeyOf(url)
    if (key) return (await readR2Object(key, { maxBytes: SOURCE_IMAGE_MAX_BYTES }))?.body ?? null
    return await safeFetchBytes(url, SOURCE_IMAGE_MAX_BYTES)
  } catch {
    return null
  }
}

/** The first frame of one of our videos, or null. */
export async function loadVideoFrame(url: string | null): Promise<Buffer | null> {
  const key = url ? ownKeyOf(url) : null
  if (!key) return null
  const dir = join(tmpdir(), `share-card-${randomUUID()}`)
  try {
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, "video")
    await downloadR2ObjectToFile(key, file, { maxBytes: SOURCE_VIDEO_MAX_BYTES, timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS })
    return await thumbnailFromLocalVideo(file)
  } catch {
    return null
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Everything a card's picture is drawn from. */
export async function loadPicture(picture: CardPicture): Promise<LoadedPicture> {
  switch (picture.kind) {
    case "picture":
      return { kind: "picture", image: await loadImage(picture.source) }
    case "video":
      return { kind: "video", frame: (await loadImage(picture.poster)) ?? (await loadVideoFrame(picture.video)) }
    case "sound":
      return { kind: "sound", art: await loadImage(picture.art), title: picture.title }
    case "grid": {
      const images = await Promise.all(picture.sources.slice(0, GRID_MAX).map((u) => loadImage(u)))
      return { kind: "grid", images: images.filter((i): i is Buffer => i !== null) }
    }
  }
}

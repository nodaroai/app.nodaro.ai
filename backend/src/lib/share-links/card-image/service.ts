/**
 * A share card's own picture: rendered once, kept on our storage, named only
 * once it is there.
 *
 * A preview reader gives a link about a second (some give it less), so the
 * card never waits for a render. It asks `renderedCardImage`, which answers from
 * what is already known to exist (this process's memo, else a Redis marker set
 * by whichever process rendered it) and never asks the bucket on the card's
 * path. When the picture is not known yet, it starts the render in the
 * background and the card answers with the best picture that is already ours.
 * A link turned on starts its render at once (`warmShareCard`,
 * card-warm.ts), so it is usually ready before anyone pastes the link.
 *
 * A render in this process is never run twice at once (one promise per key),
 * a key that exists already is only marked (a HEAD on the bucket, never the
 * CDN, whose 404s are cached for a year), and a render that failed is not
 * tried again for a while, so a public address cannot make the server render
 * on every hit. Nothing renders on an install without storage. The rendered
 * file is the platform's, not the owner's: it counts against no quota.
 *
 * The marker never expires: a picture's key names what it shows, so once it
 * exists it is that picture for good, and a marker that lapsed would make the
 * next first read of an old link answer the brand's card (which a chat keeps).
 */
import { headR2Object, isStorageConfigured, r2Url, uploadBufferToR2 } from "../../storage.js"
import { redis } from "../../queue-connection.js"
import { CARD_IMAGE_HEIGHT, CARD_IMAGE_TYPE, CARD_IMAGE_WIDTH, cardImageKey, type CardPicture } from "./plan.js"
import { loadPicture } from "./sources.js"
import { renderCardImage } from "./render.js"

export interface RenderedCardImage {
  readonly url: string
  readonly width: number
  readonly height: number
  readonly type: string
}

/** How long the card waits on Redis before answering without the rendered picture. */
export const MARKER_READ_TIMEOUT_MS = 150
/** After a failed render, how long the same picture is not tried again. */
export const RENDER_RETRY_AFTER_MS = 10 * 60 * 1000
/** The most renders this process runs at once; more wait for the next card read. */
export const MAX_CONCURRENT_RENDERS = 2

const MARKER_PREFIX = "share-card:rendered:"
const MEMO_MAX = 5000

/** Keys known to exist, in this process (oldest first, bounded). */
const memo = new Set<string>()
const inflight = new Map<string, Promise<boolean>>()
const failedAt = new Map<string, number>()

function remember(key: string): void {
  memo.delete(key)
  memo.add(key)
  if (memo.size > MEMO_MAX) memo.delete(memo.values().next().value!)
}

function imageAt(key: string): RenderedCardImage {
  return { url: r2Url(key), width: CARD_IMAGE_WIDTH, height: CARD_IMAGE_HEIGHT, type: CARD_IMAGE_TYPE }
}

async function markerSays(key: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), MARKER_READ_TIMEOUT_MS)
    })
    return (await Promise.race([redis.get(`${MARKER_PREFIX}${key}`), timeout])) === "1"
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function setMarker(key: string): Promise<void> {
  try {
    await redis.set(`${MARKER_PREFIX}${key}`, "1")
  } catch {
    // The memo still knows; another process asks the bucket once before rendering.
  }
}

async function renderAndStore(key: string, picture: CardPicture): Promise<boolean> {
  try {
    if (!(await headR2Object(key)).exists) {
      const jpeg = await renderCardImage(await loadPicture(picture))
      await uploadBufferToR2(jpeg, key, CARD_IMAGE_TYPE)
    }
    remember(key)
    failedAt.delete(key)
    await setMarker(key)
    return true
  } catch (err) {
    failedAt.set(key, Date.now())
    console.error("[share-card] rendering a card picture failed:", err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Starts rendering `picture` for the link `token`, unless it is known, being
 * rendered, recently failed, or this process is busy. Resolves true once the
 * picture exists (false when nothing was started or it failed). Never throws.
 */
export function startCardRender(token: string, picture: CardPicture): Promise<boolean> {
  if (!isStorageConfigured()) return Promise.resolve(false)
  const key = cardImageKey(token, picture)
  if (memo.has(key)) return Promise.resolve(true)
  const running = inflight.get(key)
  if (running) return running
  const failed = failedAt.get(key)
  if (failed !== undefined && Date.now() - failed < RENDER_RETRY_AFTER_MS) return Promise.resolve(false)
  if (inflight.size >= MAX_CONCURRENT_RENDERS) return Promise.resolve(false)
  const job = renderAndStore(key, picture).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/**
 * The card's own picture when it is known to exist, else null — and then its
 * render is started in the background. Fast: a memo, or one Redis read capped
 * at `MARKER_READ_TIMEOUT_MS`.
 */
export async function renderedCardImage(token: string, picture: CardPicture): Promise<RenderedCardImage | null> {
  if (!isStorageConfigured()) return null
  const key = cardImageKey(token, picture)
  if (memo.has(key)) return imageAt(key)
  if (await markerSays(key)) {
    remember(key)
    return imageAt(key)
  }
  void startCardRender(token, picture)
  return null
}

/** For tests: forget everything this process knows. */
export function resetCardImageStateForTests(): void {
  memo.clear()
  inflight.clear()
  failedAt.clear()
}

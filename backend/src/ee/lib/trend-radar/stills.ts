/**
 * A post's still, kept. The platforms' own stills are signed links that stop
 * answering within hours (TikTok's about six hours after the read), so a
 * review gallery built on them is blank by noon. The daily run copies each
 * top post's still to this deployment's storage while the link still answers,
 * shrunk to a small JPEG, and the card points at the copy.
 *
 * For the admin's review only (decided 2026-11-26): a kept still is never
 * served to a user and never an input to a generation. A deployment that
 * turns link imports off (`linkImportRefusal`) keeps none. A copy that fails
 * leaves the platform's own link, which answers for a few hours.
 */
import { createHash } from "node:crypto"
import sharp from "sharp"
import { linkImportRefusal } from "../../../lib/link-imports.js"
import { safeFetch } from "../../../lib/safe-fetch.js"
import { r2Url, uploadBufferToR2 } from "../../../lib/storage.js"
import type { TrendCandidatePost } from "./types.js"

/** Where kept stills live: one object per post, named by its link. */
export const STILL_PREFIX = "trend-radar/stills/"
const STILL_MAX_BYTES = 5 * 1024 * 1024
const STILL_WIDTH = 480
const STILL_TIMEOUT_MS = 10_000

/** The storage key of a post's kept still: the same post is always the same object. */
export function stillKey(post: Pick<TrendCandidatePost, "url">): string {
  return `${STILL_PREFIX}${createHash("sha256").update(post.url).digest("hex").slice(0, 32)}.jpg`
}

/** Whether a still link is one this deployment kept. */
export function isKeptStill(url: string | null | undefined): boolean {
  return !!url && url.startsWith(r2Url(STILL_PREFIX))
}

/** Copies one post's still into storage; its address there, or `null` when there is nothing to copy or the copy failed. */
export async function keepStill(post: TrendCandidatePost): Promise<string | null> {
  const src = post.stillUrl
  if (!src || !/^https:\/\//i.test(src) || isKeptStill(src) || linkImportRefusal(src)) return null
  try {
    const res = await safeFetch(src, { timeoutMs: STILL_TIMEOUT_MS, headers: { accept: "image/*" } })
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null
    if (Number(res.headers.get("content-length") ?? 0) > STILL_MAX_BYTES) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > STILL_MAX_BYTES) return null
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: STILL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer()
    return await uploadBufferToR2(jpeg, stillKey(post), "image/jpeg")
  } catch {
    return null
  }
}

export type KeepStill = (post: TrendCandidatePost) => Promise<string | null>

/**
 * The kept still of every post, by post link: a post an earlier read already
 * kept reuses its copy without fetching again; the others are copied now.
 * Posts without a kept still are left out.
 */
export async function keptStills(
  posts: readonly TrendCandidatePost[],
  previous: readonly TrendCandidatePost[],
  keep: KeepStill,
): Promise<Map<string, string>> {
  const earlier = new Map(previous.filter((p) => isKeptStill(p.stillUrl)).map((p) => [p.url, p.stillUrl!] as const))
  const unique = Array.from(new Map(posts.map((p) => [p.url, p])).values())
  const found = await Promise.all(unique.map(async (p) => [p.url, earlier.get(p.url) ?? (await keep(p).catch(() => null))] as const))
  return new Map(found.filter((e): e is readonly [string, string] => e[1] !== null))
}

/** The post with its kept still in place of the platform's link, when one was kept. */
export function withKeptStill(post: TrendCandidatePost, kept: ReadonlyMap<string, string>): TrendCandidatePost {
  const still = kept.get(post.url)
  return still ? { ...post, stillUrl: still } : post
}

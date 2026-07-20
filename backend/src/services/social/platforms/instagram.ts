import type { MediaItem, PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import { INSTAGRAM_CAROUSEL_MIN_ITEMS, INSTAGRAM_CAROUSEL_MAX_ITEMS } from "@nodaro/shared"
import { BadBodyError, NotPublishedError } from "../providers/types.js"

/**
 * Instagram publishing — the container -> publish flow, shared by BOTH ways of
 * reaching an Instagram account:
 *
 *   • `instagram`            — Facebook Login for Business, via graph.facebook.com.
 *                              Requires a linked Facebook Page.
 *   • `instagram-standalone` — Instagram Login, via graph.instagram.com.
 *                              No Page, and its tokens actually refresh.
 *
 * The publish semantics are identical on both hosts, so there is ONE
 * implementation parameterized by host rather than two copies that drift.
 */

export interface InstagramHost {
  /** Versioned Graph base, e.g. https://graph.facebook.com/v25.0 */
  readonly graph: string
  /**
   * How a published media id becomes a public URL. The Facebook Graph exposes
   * `shortcode` (we build the /p/ link); Instagram Login exposes `permalink`
   * directly. Asking either host for the other's field errors the whole call,
   * so this is per-host rather than a combined `fields=` list.
   */
  readonly postUrlField: "shortcode" | "permalink"
}

export const FACEBOOK_GRAPH_HOST: InstagramHost = {
  graph: "https://graph.facebook.com/v25.0",
  postUrlField: "shortcode",
}

export const INSTAGRAM_GRAPH_HOST: InstagramHost = {
  graph: "https://graph.instagram.com/v25.0",
  postUrlField: "permalink",
}

/**
 * Container readiness.
 *
 * Instagram ingests EVERY media container asynchronously — images included.
 * Calling `media_publish` before ingestion finishes fails with
 * `OAuthException` code 9007 ("Media ID is not available" / "The media is not
 * ready for publishing"). Images usually finish in a couple of seconds, which
 * is exactly why publishing them un-polled looked fine until it didn't.
 *
 * So: every container is polled to FINISHED before it is published. The
 * budget splits by media kind because video ingestion is minutes, not
 * seconds, and a uniform timeout is either too tight for video or a very
 * long stall for images.
 */
const CONTAINER_POLL_INTERVAL_MS = 2_000
const CONTAINER_TIMEOUT_IMAGE_MS = 90_000
const CONTAINER_TIMEOUT_VIDEO_MS = 300_000

/**
 * Meta can still answer 9007 on `media_publish` for a few seconds AFTER the
 * container reports FINISHED, so readiness polling alone does not close the
 * race. Re-publishing the SAME `creation_id` is safe by construction: a
 * container publishes at most once, so a retry cannot duplicate the post.
 */
const PUBLISH_RETRY_ATTEMPTS = 5
const PUBLISH_RETRY_DELAY_MS = 3_000

/** Graph error code: the container is not ready to publish. */
const MEDIA_NOT_READY_CODE = 9007

/**
 * Consecutive status-poll failures tolerated before giving up. A transient
 * blip (Graph 5xx, a rate limit, a network drop) must not abort a wait that
 * may be minutes in; a persistent failure (revoked token, dead network) must
 * not burn the whole budget before surfacing.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3

function containerTimeoutMs(isVideo: boolean): number {
  return isVideo ? CONTAINER_TIMEOUT_VIDEO_MS : CONTAINER_TIMEOUT_IMAGE_MS
}

/**
 * Callers that must answer an open HTTP request pass an absolute deadline via
 * `metadata.publishDeadlineMs` (the sync /v1/social/publish route does — its
 * callers cut a headers-less response at ~300s). Every container wait and
 * publish-retry sleep clamps to it, so the publisher reports a typed,
 * retry-safe failure BEFORE the caller's socket dies. The scheduled worker
 * holds no HTTP response, passes no deadline, and keeps the full budgets.
 */
function readDeadlineMs(metadata: Record<string, unknown>): number | undefined {
  const v = metadata.publishDeadlineMs
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined
}

function clampToDeadline(budgetMs: number, deadlineMs: number | undefined): number {
  if (deadlineMs === undefined) return budgetMs
  return Math.max(0, Math.min(budgetMs, deadlineMs - Date.now()))
}

export function createInstagramPublisher(host: InstagramHost): PlatformPublisher {
  return {
    async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
      const igUserId = metadata.instagram_user_id as string
      if (!igUserId) throw new Error("Instagram user ID not found in connection metadata")

      const { action, caption, mediaUrl } = request
      const deadlineMs = readDeadlineMs(metadata)

      if (action === "post-image" || action === "post-reel" || action === "post-story") {
        const containerParams: Record<string, unknown> = { access_token: accessToken }
        if (action === "post-image") {
          containerParams.image_url = mediaUrl!
          if (caption) containerParams.caption = caption
        } else {
          containerParams.video_url = mediaUrl!
          containerParams.media_type = action === "post-reel" ? "REELS" : "STORIES"
          if (caption && action === "post-reel") containerParams.caption = caption
        }

        const containerId = await createContainer(host, igUserId, accessToken, containerParams, "container creation failed")

        // Poll EVERY container, images included — an un-polled image container
        // is the 9007 bug, not a shortcut.
        await waitForContainer(
          host,
          accessToken,
          containerId,
          clampToDeadline(containerTimeoutMs(action !== "post-image"), deadlineMs),
        )

        const mediaId = await publishContainer(host, igUserId, accessToken, containerId, "publish failed", deadlineMs)
        return {
          success: true,
          platformPostId: mediaId,
          platformPostUrl: await fetchInstagramPostUrl(host, accessToken, mediaId),
        }
      }

      if (action === "post-carousel") {
        const { mediaItems } = request
        if (!mediaItems || mediaItems.length < INSTAGRAM_CAROUSEL_MIN_ITEMS || mediaItems.length > INSTAGRAM_CAROUSEL_MAX_ITEMS) {
          throw new Error(`Carousel requires ${INSTAGRAM_CAROUSEL_MIN_ITEMS}-${INSTAGRAM_CAROUSEL_MAX_ITEMS} items (got ${mediaItems?.length ?? 0})`)
        }
        const itemTypes = new Set(mediaItems.map((m) => m.type))
        if (itemTypes.size > 1) {
          throw new Error("Instagram carousel can't mix photos and videos")
        }
        const isVideoCarousel = mediaItems[0].type === "video"

        const itemIds = await Promise.all(
          mediaItems.map((item) => createCarouselItemContainer(host, igUserId, accessToken, item)),
        )

        // Photo children are polled too — the parent references them by id and
        // inherits any not-yet-ingested child as a 9007 at publish time.
        const itemTimeoutMs = containerTimeoutMs(isVideoCarousel)
        await Promise.all(
          itemIds.map((id) => waitForContainer(host, accessToken, id, clampToDeadline(itemTimeoutMs, deadlineMs))),
        )

        const parentId = await createContainer(
          host,
          igUserId,
          accessToken,
          {
            access_token: accessToken,
            media_type: "CAROUSEL",
            children: itemIds,
            ...(caption ? { caption } : {}),
          },
          "carousel container creation failed",
        )

        // Meta docs recommend waiting on the parent too, even for photo-only.
        await waitForContainer(host, accessToken, parentId, clampToDeadline(itemTimeoutMs, deadlineMs))

        const mediaId = await publishContainer(host, igUserId, accessToken, parentId, "carousel publish failed", deadlineMs)
        return {
          success: true,
          platformPostId: mediaId,
          platformPostUrl: await fetchInstagramPostUrl(host, accessToken, mediaId),
        }
      }

      throw new Error(`Unsupported Instagram action: ${action}`)
    },
  }
}

/** Instagram reached through a Facebook Page (Facebook Login for Business). */
export const instagramPublisher: PlatformPublisher = createInstagramPublisher(FACEBOOK_GRAPH_HOST)

/** Instagram reached directly (Instagram Login) — no Page in the chain. */
export const instagramStandalonePublisher: PlatformPublisher = createInstagramPublisher(INSTAGRAM_GRAPH_HOST)

/**
 * Resolve the logged-in Instagram account (Instagram Login only — the Facebook
 * path resolves accounts through the Page picker in meta-accounts.ts).
 */
export async function fetchInstagramStandaloneUser(
  accessToken: string,
): Promise<{ id: string; username: string; avatarUrl?: string }> {
  const res = await fetch(
    `${INSTAGRAM_GRAPH_HOST.graph}/me?fields=user_id,username,profile_picture_url&access_token=${accessToken}`,
  )
  const data = (await res.json()) as {
    user_id?: string
    id?: string
    username?: string
    profile_picture_url?: string
    error?: { message?: string }
  }
  // Instagram Login returns the publishable id as `user_id`; `id` is the
  // app-scoped id and is NOT accepted by the /media endpoints.
  const id = data.user_id ?? data.id
  if (!res.ok || !id) throw new Error(data.error?.message || "Instagram user lookup failed")
  return { id, username: data.username ? `@${data.username}` : "", avatarUrl: data.profile_picture_url }
}

/**
 * Long-lived token refresh (~60 days). This is the whole point of the
 * standalone provider: unlike Facebook Page tokens, these self-heal, so the
 * account never lands in the Reconnect state.
 */
export async function refreshInstagramStandaloneToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${refreshToken}`,
  )
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message || "Instagram token refresh failed")
  }
  // The token is its own refresh credential, same as Threads.
  return {
    accessToken: data.access_token,
    refreshToken: data.access_token,
    expiresIn: data.expires_in ?? 60 * 24 * 3600,
  }
}

/**
 * Container creation is provably pre-publish, so every failure here is typed:
 * a network-level failure can at worst have created a container that is never
 * published (it just expires), and a Graph rejection created nothing. Neither
 * may ever surface as "the post MAY have been published".
 */
async function createContainer(
  host: InstagramHost,
  igUserId: string,
  accessToken: string,
  body: Record<string, unknown>,
  errorLabel: string,
): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${host.graph}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new NotPublishedError(
      `Instagram ${errorLabel}: network error (${msg}). The post was NOT published — retrying is safe.`,
    )
  }
  if (!res.ok) {
    const detail = `Instagram ${errorLabel}: ${await res.text()}`
    // 5xx is transient (retry-safe); 4xx is Meta definitively rejecting the
    // container (bad media URL, permissions) — retrying cannot help.
    if (res.status >= 500) throw new NotPublishedError(detail)
    throw new BadBodyError(detail)
  }
  const data = await res.json() as { id: string }
  return data.id
}

/**
 * Meta reports 9007 as a Graph error code, but some edges only carry it in the
 * message text. Match either, so a response-shape change downgrades to a
 * slower path rather than silently losing the retry.
 */
function isMediaNotReady(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number } }
    if (parsed.error?.code === MEDIA_NOT_READY_CODE) return true
  } catch {
    // Non-JSON error body — fall through to the text match.
  }
  return /not ready for publishing|Media ID is not available/i.test(body)
}

async function publishContainer(
  host: InstagramHost,
  igUserId: string,
  accessToken: string,
  containerId: string,
  errorLabel: string,
  deadlineMs?: number,
): Promise<string> {
  let lastBody = ""
  let attemptsMade = 0
  for (let attempt = 1; attempt <= PUBLISH_RETRY_ATTEMPTS; attempt++) {
    attemptsMade = attempt
    // Deliberately NOT wrapped: a fetch() rejection here means the publish
    // request may have reached Meta, so the outcome is genuinely unknown —
    // execute-publish's UnknownOutcomeError wrap is the truthful report.
    const res = await fetch(`${host.graph}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    })
    if (res.ok) return ((await res.json()) as { id: string }).id

    lastBody = await res.text()
    // Anything other than "not ready yet" is a real rejection — surface it now
    // instead of burning the retry budget on an error that will not change.
    if (!isMediaNotReady(lastBody)) throw new Error(`Instagram ${errorLabel}: ${lastBody}`)
    if (attempt === PUBLISH_RETRY_ATTEMPTS) break
    // Stop early when the caller's deadline would pass before the next try —
    // better to answer "not published, retry safe" than to blow the deadline.
    if (deadlineMs !== undefined && Date.now() + PUBLISH_RETRY_DELAY_MS >= deadlineMs) break
    await new Promise((r) => setTimeout(r, PUBLISH_RETRY_DELAY_MS))
  }
  // Still 9007 after the budget. Meta refused to publish, so nothing was
  // posted — a definite, retryable failure, NOT an unknown outcome.
  throw new NotPublishedError(
    `Instagram ${errorLabel}: media still not ready after ${attemptsMade} attempt(s) ` +
      `(code ${MEDIA_NOT_READY_CODE}). The post was NOT published — retrying is safe. ${lastBody}`,
  )
}

async function createCarouselItemContainer(
  host: InstagramHost,
  igUserId: string,
  accessToken: string,
  item: MediaItem,
): Promise<string> {
  const body: Record<string, unknown> = {
    access_token: accessToken,
    is_carousel_item: true,
  }
  if (item.type === "photo") {
    body.image_url = item.url
  } else {
    body.video_url = item.url
    body.media_type = "VIDEO"
  }
  return createContainer(host, igUserId, accessToken, body, `carousel item container creation failed (${item.type})`)
}

async function fetchInstagramPostUrl(
  host: InstagramHost,
  accessToken: string,
  mediaId: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${host.graph}/${mediaId}?fields=${host.postUrlField}&access_token=${accessToken}`)
    if (!res.ok) return undefined
    const data = await res.json() as { shortcode?: string; permalink?: string }
    if (host.postUrlField === "permalink") return data.permalink
    return data.shortcode ? `https://www.instagram.com/p/${data.shortcode}/` : undefined
  } catch {
    return undefined
  }
}

/**
 * Block until Meta finishes ingesting `containerId`.
 *
 * Every exit is pre-`media_publish`, so no outcome here can have posted
 * anything — which is why every throw is typed (BadBodyError /
 * NotPublishedError) rather than a bare Error that `execute-publish.ts` would
 * report as "the post MAY have been published".
 */
async function waitForContainer(
  host: InstagramHost,
  accessToken: string,
  containerId: string,
  maxWaitMs: number,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs
  let lastStatus = "UNKNOWN"
  let consecutiveFailures = 0
  for (;;) {
    // A transient poll failure (Graph 5xx, a rate limit, a network drop) must
    // not abort a wait that may be minutes in — tolerate a short streak and
    // keep polling. A persistent one (revoked token, dead network) fails fast
    // instead of burning the rest of the budget.
    let failure: string | undefined
    try {
      const res = await fetch(
        `${host.graph}/${containerId}?fields=status_code&access_token=${accessToken}`,
      )
      if (res.ok) {
        consecutiveFailures = 0
        const data = (await res.json()) as { status_code?: string }
        lastStatus = data.status_code ?? lastStatus
        if (lastStatus === "FINISHED") return
        // Terminal states: this container is dead and will never publish. A
        // fresh attempt would have to re-upload, so no automatic retry.
        if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
          throw new BadBodyError(
            `Instagram media processing failed (status_code=${lastStatus}) — the post was not published.`,
          )
        }
      } else {
        failure = `HTTP ${res.status}: ${await res.text()}`
      }
    } catch (err) {
      if (err instanceof BadBodyError) throw err
      failure = err instanceof Error ? err.message : String(err)
    }
    if (failure !== undefined) {
      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new NotPublishedError(
          `Instagram container status check failed ${consecutiveFailures} times in a row (${failure}). ` +
            `The post was NOT published — retrying is safe.`,
        )
      }
    }
    if (Date.now() >= deadline) break
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS))
  }
  throw new NotPublishedError(
    `Instagram media processing did not finish within ${Math.round(maxWaitMs / 1000)}s ` +
      `(last status_code=${lastStatus}). The post was NOT published — retrying is safe.`,
  )
}

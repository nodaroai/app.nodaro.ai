import type { MediaItem, PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import { INSTAGRAM_CAROUSEL_MIN_ITEMS, INSTAGRAM_CAROUSEL_MAX_ITEMS } from "@nodaro/shared"

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

export function createInstagramPublisher(host: InstagramHost): PlatformPublisher {
  return {
    async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
      const igUserId = metadata.instagram_user_id as string
      if (!igUserId) throw new Error("Instagram user ID not found in connection metadata")

      const { action, caption, mediaUrl } = request

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

        if (action === "post-reel" || action === "post-story") {
          await waitForContainer(host, accessToken, containerId)
        }

        const mediaId = await publishContainer(host, igUserId, accessToken, containerId, "publish failed")
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

        if (isVideoCarousel) {
          await Promise.all(itemIds.map((id) => waitForContainer(host, accessToken, id)))
        }

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
        await waitForContainer(host, accessToken, parentId)

        const mediaId = await publishContainer(host, igUserId, accessToken, parentId, "carousel publish failed")
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

async function createContainer(
  host: InstagramHost,
  igUserId: string,
  accessToken: string,
  body: Record<string, unknown>,
  errorLabel: string,
): Promise<string> {
  const res = await fetch(`${host.graph}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Instagram ${errorLabel}: ${await res.text()}`)
  const data = await res.json() as { id: string }
  return data.id
}

async function publishContainer(
  host: InstagramHost,
  igUserId: string,
  accessToken: string,
  containerId: string,
  errorLabel: string,
): Promise<string> {
  const res = await fetch(`${host.graph}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  })
  if (!res.ok) throw new Error(`Instagram ${errorLabel}: ${await res.text()}`)
  const data = await res.json() as { id: string }
  return data.id
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

async function waitForContainer(
  host: InstagramHost,
  accessToken: string,
  containerId: string,
  maxWaitMs = 120_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${host.graph}/${containerId}?fields=status_code&access_token=${accessToken}`,
    )
    const data = await res.json() as { status_code: string }
    if (data.status_code === "FINISHED") return
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed")
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Instagram media processing timed out")
}

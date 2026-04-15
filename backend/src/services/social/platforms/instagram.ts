import type { MediaItem, PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import {
  INSTAGRAM_CAROUSEL_MIN_ITEMS,
  INSTAGRAM_CAROUSEL_MAX_ITEMS,
} from "../../../../../packages/shared/src/social-post.js"

const GRAPH_API = "https://graph.facebook.com/v25.0"

export const instagramPublisher: PlatformPublisher = {
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

      const containerId = await createContainer(igUserId, accessToken, containerParams, "container creation failed")

      if (action === "post-reel" || action === "post-story") {
        await waitForContainer(accessToken, containerId)
      }

      const mediaId = await publishContainer(igUserId, accessToken, containerId, "publish failed")
      return {
        success: true,
        platformPostId: mediaId,
        platformPostUrl: await fetchInstagramPostUrl(accessToken, mediaId),
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
        mediaItems.map((item) => createCarouselItemContainer(igUserId, accessToken, item)),
      )

      if (isVideoCarousel) {
        await Promise.all(itemIds.map((id) => waitForContainer(accessToken, id)))
      }

      const parentId = await createContainer(
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
      await waitForContainer(accessToken, parentId)

      const mediaId = await publishContainer(igUserId, accessToken, parentId, "carousel publish failed")
      return {
        success: true,
        platformPostId: mediaId,
        platformPostUrl: await fetchInstagramPostUrl(accessToken, mediaId),
      }
    }

    throw new Error(`Unsupported Instagram action: ${action}`)
  },
}

async function createContainer(
  igUserId: string,
  accessToken: string,
  body: Record<string, unknown>,
  errorLabel: string,
): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Instagram ${errorLabel}: ${await res.text()}`)
  const data = await res.json() as { id: string }
  return data.id
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string,
  errorLabel: string,
): Promise<string> {
  const res = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  })
  if (!res.ok) throw new Error(`Instagram ${errorLabel}: ${await res.text()}`)
  const data = await res.json() as { id: string }
  return data.id
}

async function createCarouselItemContainer(
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
  return createContainer(igUserId, accessToken, body, `carousel item container creation failed (${item.type})`)
}

async function fetchInstagramPostUrl(accessToken: string, mediaId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${GRAPH_API}/${mediaId}?fields=shortcode&access_token=${accessToken}`)
    if (!res.ok) return undefined
    const data = await res.json() as { shortcode?: string }
    return data.shortcode ? `https://www.instagram.com/p/${data.shortcode}/` : undefined
  } catch {
    return undefined
  }
}

async function waitForContainer(accessToken: string, containerId: string, maxWaitMs = 120_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`,
    )
    const data = await res.json() as { status_code: string }
    if (data.status_code === "FINISHED") return
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed")
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Instagram media processing timed out")
}

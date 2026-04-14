import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"

export const instagramPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
    const igUserId = metadata.instagram_user_id as string
    if (!igUserId) throw new Error("Instagram user ID not found in connection metadata")

    const { action, caption, mediaUrl } = request

    if (action === "post-image" || action === "post-reel" || action === "post-story") {
      // Step 1: Create media container
      const containerParams: Record<string, string> = {
        access_token: accessToken,
      }

      if (action === "post-image") {
        containerParams.image_url = mediaUrl!
        if (caption) containerParams.caption = caption
      } else if (action === "post-reel" || action === "post-story") {
        containerParams.video_url = mediaUrl!
        containerParams.media_type = action === "post-reel" ? "REELS" : "STORIES"
        if (caption && action === "post-reel") containerParams.caption = caption
      }

      const containerRes = await fetch(
        `https://graph.facebook.com/v25.0/${igUserId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerParams),
        },
      )
      if (!containerRes.ok) {
        const err = await containerRes.text()
        throw new Error(`Instagram container creation failed: ${err}`)
      }
      const container = await containerRes.json() as { id: string }

      // Step 2: Wait for container to be ready (for video)
      if (action === "post-reel" || action === "post-story") {
        await waitForContainer(accessToken, container.id)
      }

      // Step 3: Publish
      const publishRes = await fetch(
        `https://graph.facebook.com/v25.0/${igUserId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: container.id,
            access_token: accessToken,
          }),
        },
      )
      if (!publishRes.ok) {
        const err = await publishRes.text()
        throw new Error(`Instagram publish failed: ${err}`)
      }
      const result = await publishRes.json() as { id: string }

      // Fetch shortcode for the post URL (media ID != shortcode)
      let platformPostUrl: string | undefined
      try {
        const mediaRes = await fetch(
          `https://graph.facebook.com/v25.0/${result.id}?fields=shortcode&access_token=${accessToken}`,
        )
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json() as { shortcode?: string }
          if (mediaData.shortcode) {
            platformPostUrl = `https://www.instagram.com/p/${mediaData.shortcode}/`
          }
        }
      } catch {
        // Non-critical — URL is just for UI convenience
      }

      return {
        success: true,
        platformPostId: result.id,
        platformPostUrl,
      }
    }

    if (action === "post-carousel") {
      const { mediaItems } = request
      if (!mediaItems || mediaItems.length < 2 || mediaItems.length > 10) {
        throw new Error(`Carousel requires 2-10 items (got ${mediaItems?.length ?? 0})`)
      }
      const itemTypes = new Set(mediaItems.map((m) => m.type))
      if (itemTypes.size > 1) {
        throw new Error("Instagram carousel can't mix photos and videos")
      }
      const isVideoCarousel = mediaItems[0].type === "video"

      // Step 1 — create child containers in parallel.
      const itemIds = await Promise.all(
        mediaItems.map((item) => createCarouselItemContainer(igUserId, accessToken, item)),
      )

      // Step 2 — video carousels need each child to finish processing.
      if (isVideoCarousel) {
        for (const id of itemIds) {
          await waitForContainer(accessToken, id)
        }
      }

      // Step 3 — create parent CAROUSEL container (caption goes here only).
      const parentRes = await fetch(
        `https://graph.facebook.com/v25.0/${igUserId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: accessToken,
            media_type: "CAROUSEL",
            children: itemIds,
            ...(caption ? { caption } : {}),
          }),
        },
      )
      if (!parentRes.ok) {
        const err = await parentRes.text()
        throw new Error(`Instagram carousel container creation failed: ${err}`)
      }
      const parent = await parentRes.json() as { id: string }

      // Meta docs recommend waiting on the parent too, even for photo-only.
      await waitForContainer(accessToken, parent.id)

      // Step 4 — publish the carousel container.
      const publishRes = await fetch(
        `https://graph.facebook.com/v25.0/${igUserId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: parent.id,
            access_token: accessToken,
          }),
        },
      )
      if (!publishRes.ok) {
        const err = await publishRes.text()
        throw new Error(`Instagram carousel publish failed: ${err}`)
      }
      const result = await publishRes.json() as { id: string }

      // Fetch shortcode (best-effort).
      let platformPostUrl: string | undefined
      try {
        const mediaRes = await fetch(
          `https://graph.facebook.com/v25.0/${result.id}?fields=shortcode&access_token=${accessToken}`,
        )
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json() as { shortcode?: string }
          if (mediaData.shortcode) {
            platformPostUrl = `https://www.instagram.com/p/${mediaData.shortcode}/`
          }
        }
      } catch {
        // Non-critical.
      }

      return {
        success: true,
        platformPostId: result.id,
        platformPostUrl,
      }
    }

    throw new Error(`Unsupported Instagram action: ${action}`)
  },
}

async function createCarouselItemContainer(
  igUserId: string,
  accessToken: string,
  item: { type: "photo" | "video"; url: string },
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
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Instagram carousel item container creation failed (${item.type}): ${err}`)
  }
  const data = await res.json() as { id: string }
  return data.id
}

async function waitForContainer(accessToken: string, containerId: string, maxWaitMs = 120_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${accessToken}`,
    )
    const data = await res.json() as { status_code: string }
    if (data.status_code === "FINISHED") return
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed")
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Instagram media processing timed out")
}

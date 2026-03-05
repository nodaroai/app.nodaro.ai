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
        `https://graph.facebook.com/v21.0/${igUserId}/media`,
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
        `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
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
          `https://graph.facebook.com/v21.0/${result.id}?fields=shortcode&access_token=${accessToken}`,
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
      throw new Error("Carousel posts not yet implemented")
    }

    throw new Error(`Unsupported Instagram action: ${action}`)
  },
}

async function waitForContainer(accessToken: string, containerId: string, maxWaitMs = 120_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`,
    )
    const data = await res.json() as { status_code: string }
    if (data.status_code === "FINISHED") return
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed")
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Instagram media processing timed out")
}

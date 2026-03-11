import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"

export const facebookPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
    const pageId = metadata.page_id as string
    const pageAccessToken = metadata.page_access_token as string || accessToken
    if (!pageId) throw new Error("Facebook page ID not found in connection metadata")

    const { action, caption, mediaUrl } = request

    if (action === "post-text") {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: caption || "",
          access_token: pageAccessToken,
        }),
      })
      if (!res.ok) throw new Error(`Facebook post failed: ${await res.text()}`)
      const data = await res.json() as { id: string }
      return { success: true, platformPostId: data.id }
    }

    if (action === "post-image") {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: mediaUrl,
          caption: caption || "",
          access_token: pageAccessToken,
        }),
      })
      if (!res.ok) throw new Error(`Facebook photo post failed: ${await res.text()}`)
      const data = await res.json() as { id: string; post_id?: string }
      return {
        success: true,
        platformPostId: data.post_id || data.id,
        platformPostUrl: `https://www.facebook.com/${data.post_id || data.id}`,
      }
    }

    if (action === "post-video") {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: mediaUrl,
          description: caption || "",
          access_token: pageAccessToken,
        }),
      })
      if (!res.ok) throw new Error(`Facebook video post failed: ${await res.text()}`)
      const data = await res.json() as { id: string }
      return { success: true, platformPostId: data.id }
    }

    if (action === "post-story") {
      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/video_stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: mediaUrl,
          access_token: pageAccessToken,
        }),
      })
      if (!res.ok) throw new Error(`Facebook story post failed: ${await res.text()}`)
      const data = await res.json() as { id: string }
      return { success: true, platformPostId: data.id }
    }

    throw new Error(`Unsupported Facebook action: ${action}`)
  },
}

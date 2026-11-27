import type { PublishRequest, PublishResult, PlatformPublisher } from "./index.js"
import { graphRefusal } from "./graph-error.js"

const GRAPH = "https://graph.facebook.com/v25.0"

/**
 * One Graph POST. A failure is typed by what it proves:
 *  - HTTP 4xx: Facebook refused the request (code 100 "Invalid parameter" for
 *    a photo over its 10 MB limit, a missing permission, a URL it could not
 *    read). Nothing was posted, so it is a definite failure in Facebook's own
 *    words (`graphRefusal`).
 *  - HTTP 5xx, or no answer at all (a lost connection, a timeout): the request
 *    reached Facebook and may have been acted on, so it stays a plain Error,
 *    which execute-publish reports as an unknown outcome and never retries
 *    blind.
 */
async function postToGraph<T>(path: string, body: Record<string, unknown>, label: string): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (res.ok) return (await res.json()) as T
  // The status alone decides; a body that cannot be read leaves the sentence empty, not the verdict.
  const text = await res.text().catch(() => "")
  if (res.status >= 400 && res.status < 500) throw graphRefusal(label, res.status, text)
  throw new Error(`${label}: ${text || `HTTP ${res.status}`}`)
}

export const facebookPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest, metadata: Record<string, unknown>): Promise<PublishResult> {
    const pageId = metadata.page_id as string
    const pageAccessToken = metadata.page_access_token as string || accessToken
    if (!pageId) throw new Error("Facebook page ID not found in connection metadata")

    const { action, caption, mediaUrl } = request

    if (action === "post-text") {
      const data = await postToGraph<{ id: string }>(
        `${pageId}/feed`,
        { message: caption || "", access_token: pageAccessToken },
        "Facebook post failed",
      )
      return { success: true, platformPostId: data.id }
    }

    if (action === "post-image") {
      const data = await postToGraph<{ id: string; post_id?: string }>(
        `${pageId}/photos`,
        { url: mediaUrl, caption: caption || "", access_token: pageAccessToken },
        "Facebook photo post failed",
      )
      return {
        success: true,
        platformPostId: data.post_id || data.id,
        platformPostUrl: `https://www.facebook.com/${data.post_id || data.id}`,
      }
    }

    if (action === "post-video") {
      const data = await postToGraph<{ id: string }>(
        `${pageId}/videos`,
        { file_url: mediaUrl, description: caption || "", access_token: pageAccessToken },
        "Facebook video post failed",
      )
      return { success: true, platformPostId: data.id }
    }

    if (action === "post-story") {
      const data = await postToGraph<{ id: string }>(
        `${pageId}/video_stories`,
        { video_url: mediaUrl, access_token: pageAccessToken },
        "Facebook story post failed",
      )
      return { success: true, platformPostId: data.id }
    }

    throw new Error(`Unsupported Facebook action: ${action}`)
  },
}

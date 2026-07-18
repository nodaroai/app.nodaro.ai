import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Reddit — OAuth2 (Basic token auth). Reddit REQUIRES a descriptive
 * User-Agent on every API call. Target subreddit: first tag on the request,
 * falling back to `metadata.default_subreddit`.
 */

const UA = "web:ai.nodaro.app:v1 (social publisher)"

export async function fetchRedditUser(accessToken: string): Promise<{ id: string; username: string; avatarUrl?: string }> {
  const res = await fetch("https://oauth.reddit.com/api/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
  })
  const data = (await res.json()) as { id?: string; name?: string; icon_img?: string; message?: string }
  if (!res.ok || !data.id) throw new Error(data.message || "Reddit user lookup failed")
  return { id: data.id, username: `u/${data.name}`, avatarUrl: data.icon_img?.split("?")[0] }
}

export const redditPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const subreddit = request.tags?.[0] ?? (metadata.default_subreddit as string | undefined)
    if (!subreddit) {
      return { success: false, error: "Reddit needs a target subreddit — pass it as the first tag" }
    }
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "Reddit posts need a title" }

    const isLink = Boolean(request.mediaUrl)
    const body = new URLSearchParams({
      api_type: "json",
      sr: subreddit.replace(/^r\//, ""),
      title,
      kind: isLink ? "link" : "self",
      ...(isLink ? { url: request.mediaUrl! } : { text: request.description ?? request.caption ?? "" }),
    })

    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })
    const data = (await res.json()) as {
      json?: { errors?: Array<[string, string]>; data?: { id?: string; url?: string } }
    }
    const errors = data.json?.errors
    if (!res.ok || (errors && errors.length > 0) || !data.json?.data) {
      return { success: false, error: errors?.[0]?.[1] || "Reddit submit failed" }
    }
    return {
      success: true,
      platformPostId: data.json.data.id,
      platformPostUrl: data.json.data.url,
    }
  },
}

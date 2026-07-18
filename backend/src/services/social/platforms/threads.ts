import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Threads (Meta) — container -> publish flow on graph.threads.net.
 * Real token refresh via GET th_refresh_token (~60-day tokens).
 */

const GRAPH = "https://graph.threads.net/v1.0"

export async function fetchThreadsUser(accessToken: string): Promise<{ id: string; username: string; avatarUrl?: string }> {
  const res = await fetch(
    `${GRAPH}/me?fields=id,username,threads_profile_picture_url&access_token=${accessToken}`,
  )
  const data = (await res.json()) as { id?: string; username?: string; threads_profile_picture_url?: string; error?: { message?: string } }
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Threads user lookup failed")
  return { id: data.id, username: `@${data.username}`, avatarUrl: data.threads_profile_picture_url }
}

export async function refreshThreadsToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await fetch(
    `${GRAPH.replace("/v1.0", "")}/refresh_access_token?grant_type=th_refresh_token&access_token=${refreshToken}`,
  )
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } }
  if (!res.ok || !data.access_token) throw new Error(data.error?.message || "Threads token refresh failed")
  // Threads tokens are their own refresh credential.
  return { accessToken: data.access_token, refreshToken: data.access_token, expiresIn: data.expires_in ?? 60 * 24 * 3600 }
}

export const threadsPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const userId = metadata.threads_user_id as string | undefined
    if (!userId) return { success: false, error: "Threads connection is missing its user id" }

    const text = request.caption ?? request.title ?? ""
    const params = new URLSearchParams({ access_token: accessToken, text })
    if (request.mediaUrl && request.action !== "post-text") {
      params.set("media_type", "IMAGE")
      params.set("image_url", request.mediaUrl)
    } else {
      params.set("media_type", "TEXT")
    }

    const createRes = await fetch(`${GRAPH}/${userId}/threads?${params.toString()}`, { method: "POST" })
    const createData = (await createRes.json()) as { id?: string; error?: { message?: string } }
    if (!createRes.ok || !createData.id) {
      return { success: false, error: createData.error?.message || "Threads container failed" }
    }

    const pubRes = await fetch(
      `${GRAPH}/${userId}/threads_publish?creation_id=${createData.id}&access_token=${accessToken}`,
      { method: "POST" },
    )
    const pubData = (await pubRes.json()) as { id?: string; error?: { message?: string } }
    if (!pubRes.ok || !pubData.id) {
      return { success: false, error: pubData.error?.message || "Threads publish failed" }
    }
    return { success: true, platformPostId: pubData.id }
  },
}

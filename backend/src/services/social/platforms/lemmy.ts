import { parseJsonOrThrow } from "./safe-json.js"
import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Lemmy — per-instance login (username + password), posts into a community.
 * accessToken = the password (a JWT is obtained per publish); metadata:
 * { service, identifier, community }.
 */

export async function lemmyLogin(service: string, identifier: string, password: string): Promise<string> {
  const res = await fetch(`${service}/api/v3/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: identifier, password }),
  })
  const data = await parseJsonOrThrow<{ jwt?: string; error?: string }>(res, "Lemmy")
  if (!res.ok || !data.jwt) throw new Error(data.error || "Lemmy login failed")
  return data.jwt
}

export async function resolveLemmyCommunity(service: string, jwt: string, name: string): Promise<number> {
  const res = await fetch(
    `${service}/api/v3/community?name=${encodeURIComponent(name)}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  )
  const data = await parseJsonOrThrow<{ community_view?: { community: { id: number } }; error?: string }>(res, "Lemmy")
  if (!res.ok || !data.community_view) throw new Error(data.error || `Lemmy community "${name}" not found`)
  return data.community_view.community.id
}

export const lemmyPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const service = metadata.service as string | undefined
    const identifier = metadata.identifier as string | undefined
    const community = metadata.community as string | undefined
    if (!service || !identifier || !community) {
      return { success: false, error: "Lemmy connection is missing service/identifier/community" }
    }
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "Lemmy posts need a title" }

    const jwt = await lemmyLogin(service, identifier, accessToken)
    const communityId = await resolveLemmyCommunity(service, jwt, community)

    const res = await fetch(`${service}/api/v3/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        name: title,
        body: request.description ?? request.caption ?? undefined,
        community_id: communityId,
        ...(request.mediaUrl ? { url: request.mediaUrl } : {}),
      }),
    })
    const data = await parseJsonOrThrow<{ post_view?: { post: { id: number } }; error?: string }>(res, "Lemmy")
    if (!res.ok || !data.post_view) return { success: false, error: data.error || "Lemmy publish failed" }
    return {
      success: true,
      platformPostId: String(data.post_view.post.id),
      platformPostUrl: `${service}/post/${data.post_view.post.id}`,
    }
  },
}

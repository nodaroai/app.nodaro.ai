import { parseJsonOrThrow } from "./safe-json.js"
import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * WordPress (self-hosted or .com with application passwords) — REST v2 with
 * Basic auth. accessToken = the application password; metadata: { domain, username }.
 */

function authHeader(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`
}

export async function fetchWordpressUser(
  domain: string,
  username: string,
  appPassword: string,
): Promise<{ id: string; username: string }> {
  const res = await fetch(`${domain}/wp-json/wp/v2/users/me`, {
    headers: { Authorization: authHeader(username, appPassword) },
  })
  const data = await parseJsonOrThrow<{ id?: number; name?: string; message?: string }>(res, "WordPress")
  if (!res.ok || !data.id) {
    throw new Error(data.message || "WordPress login failed — check domain, username, and application password")
  }
  return { id: String(data.id), username: data.name ?? username }
}

export const wordpressPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const domain = metadata.domain as string | undefined
    const username = metadata.username as string | undefined
    if (!domain || !username) return { success: false, error: "WordPress connection is missing its domain" }
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "WordPress posts need a title" }

    const body = request.description ?? request.caption ?? ""
    const content = request.mediaUrl
      ? `<img src="${request.mediaUrl}" style="max-width:100%" />\n${body}`
      : body

    const res = await fetch(`${domain}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader(username, accessToken) },
      body: JSON.stringify({ title, content, status: "publish" }),
    })
    const data = await parseJsonOrThrow<{ id?: number; link?: string; message?: string }>(res, "WordPress")
    if (!res.ok || !data.id) return { success: false, error: data.message || "WordPress publish failed" }
    return { success: true, platformPostId: String(data.id), platformPostUrl: data.link }
  },
}

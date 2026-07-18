import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Mastodon — single env-configured instance (`MASTODON_URL`, default
 * mastodon.social). NOT custom_fields: standard OAuth2 against the instance
 * the deployment registered its app on. Publish host comes from the
 * CONNECTION metadata (not env) so existing connections keep working even if
 * the deployment's default instance later changes — the mastodon-custom bug
 * we refused to copy from the reference implementation.
 */

export function mastodonBaseUrl(): string {
  return (process.env.MASTODON_URL || "https://mastodon.social").replace(/\/+$/, "")
}

export async function fetchMastodonUser(accessToken: string): Promise<{ id: string; username: string; avatarUrl?: string; service: string }> {
  const service = mastodonBaseUrl()
  const res = await fetch(`${service}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = (await res.json()) as { id?: string; acct?: string; avatar?: string; error?: string }
  if (!res.ok || !data.id) throw new Error(data.error || "Mastodon credential check failed")
  return { id: data.id, username: `@${data.acct}`, avatarUrl: data.avatar, service }
}

async function uploadMedia(service: string, accessToken: string, url: string): Promise<string> {
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch media: ${imgRes.status}`)
  const blob = await imgRes.arrayBuffer()
  const form = new FormData()
  form.append("file", new Blob([blob], { type: imgRes.headers.get("content-type") ?? "image/jpeg" }), "media")

  const res = await fetch(`${service}/api/v2/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  const data = (await res.json()) as { id?: string; error?: string }
  if (!res.ok || !data.id) throw new Error(data.error || "Mastodon media upload failed")
  return data.id
}

export const mastodonPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const service = (metadata.service as string) || mastodonBaseUrl()

    const mediaIds: string[] = []
    const images = (request.mediaItems ?? []).filter((m) => m.type === "photo").slice(0, 4)
    if (images.length === 0 && request.mediaUrl && request.action !== "post-text") {
      images.push({ type: "photo", url: request.mediaUrl })
    }
    for (const img of images) {
      mediaIds.push(await uploadMedia(service, accessToken, img.url))
    }

    const res = await fetch(`${service}/api/v1/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        status: request.caption ?? request.title ?? "",
        ...(mediaIds.length ? { media_ids: mediaIds } : {}),
        visibility: request.privacy === "private" ? "private" : "public",
      }),
    })
    const data = (await res.json()) as { id?: string; url?: string; error?: string }
    if (!res.ok || !data.id) return { success: false, error: data.error || "Mastodon post failed" }
    return { success: true, platformPostId: data.id, platformPostUrl: data.url }
  },
}

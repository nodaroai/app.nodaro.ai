import { parseJsonOrThrow } from "./safe-json.js"
import type { MediaItem, PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Bluesky (ATProto). The stored secret is the user's APP PASSWORD; a session
 * is created per publish (access JWTs live ~2h, so persisting them would just
 * add refresh bookkeeping — createSession is one cheap call).
 * Connection metadata: { service, identifier, did }.
 */

interface BskySession {
  accessJwt: string
  did: string
  handle: string
}

export async function createBlueskySession(
  service: string,
  identifier: string,
  password: string,
): Promise<BskySession> {
  const res = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  })
  const data = await parseJsonOrThrow<Record<string, unknown>>(res, "Bluesky")
  if (!res.ok || !data.accessJwt) {
    throw new Error((data.message as string) || "Bluesky login failed — check handle and app password")
  }
  return { accessJwt: data.accessJwt as string, did: data.did as string, handle: data.handle as string }
}

async function uploadImageBlob(service: string, accessJwt: string, url: string): Promise<unknown> {
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch media: ${imgRes.status}`)
  const bytes = Buffer.from(await imgRes.arrayBuffer())
  const contentType = imgRes.headers.get("content-type") || "image/jpeg"

  const res = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${accessJwt}` },
    body: bytes,
  })
  const data = await parseJsonOrThrow<{ blob?: unknown; message?: string }>(res, "Bluesky")
  if (!res.ok || !data.blob) throw new Error(data.message || "Bluesky blob upload failed")
  return data.blob
}

export const blueskyPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const service = (metadata.service as string) || "https://bsky.social"
    const identifier = metadata.identifier as string
    if (!identifier) return { success: false, error: "Bluesky connection is missing its identifier" }

    const session = await createBlueskySession(service, identifier, accessToken)

    const text = request.caption ?? request.title ?? ""
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
    }

    const images: MediaItem[] = (request.mediaItems ?? []).filter((m) => m.type === "photo")
    if (images.length === 0 && request.mediaUrl && request.action !== "post-text") {
      images.push({ type: "photo", url: request.mediaUrl })
    }
    if (images.length > 0) {
      const blobs = []
      for (const img of images.slice(0, 4)) {
        blobs.push({ alt: "", image: await uploadImageBlob(service, session.accessJwt, img.url) })
      }
      record.embed = { $type: "app.bsky.embed.images", images: blobs }
    }

    const res = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    })
    const data = await parseJsonOrThrow<{ uri?: string; message?: string }>(res, "Bluesky")
    if (!res.ok || !data.uri) {
      return { success: false, error: data.message || "Bluesky post failed" }
    }

    const rkey = data.uri.split("/").pop()
    return {
      success: true,
      platformPostId: data.uri,
      platformPostUrl: `https://bsky.app/profile/${session.handle}/post/${rkey}`,
    }
  },
}

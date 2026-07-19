import { parseJsonOrThrow } from "./safe-json.js"
import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/** dev.to — API-key connect, markdown articles. accessToken = the API key. */

export async function fetchDevtoUser(apiKey: string): Promise<{ id: string; username: string }> {
  const res = await fetch("https://dev.to/api/users/me", { headers: { "api-key": apiKey } })
  const data = await parseJsonOrThrow<{ id?: number; username?: string; error?: string }>(res, "Dev.to")
  if (!res.ok || !data.id) throw new Error(data.error || "dev.to API key rejected")
  return { id: String(data.id), username: data.username ?? String(data.id) }
}

export const devtoPublisher: PlatformPublisher = {
  async publish(accessToken: string, request: PublishRequest): Promise<PublishResult> {
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "dev.to articles need a title" }
    const body = request.description ?? request.caption ?? ""

    const res = await fetch("https://dev.to/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": accessToken },
      body: JSON.stringify({
        article: {
          title,
          body_markdown: body,
          published: true,
          tags: (request.tags ?? []).slice(0, 4).map((t) => t.replace(/[^a-z0-9]/gi, "").toLowerCase()),
          ...(request.mediaUrl ? { main_image: request.mediaUrl } : {}),
        },
      }),
    })
    const data = await parseJsonOrThrow<{ id?: number; url?: string; error?: string }>(res, "Dev.to")
    if (!res.ok || !data.id) return { success: false, error: data.error || "dev.to publish failed" }
    return { success: true, platformPostId: String(data.id), platformPostUrl: data.url }
  },
}

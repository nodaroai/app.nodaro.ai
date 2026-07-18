import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/** Medium — integration-token connect. metadata stores the author id. */

export async function fetchMediumUser(token: string): Promise<{ id: string; username: string }> {
  const res = await fetch("https://api.medium.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json()) as { data?: { id: string; username: string }; errors?: Array<{ message: string }> }
  if (!res.ok || !data.data?.id) {
    throw new Error(data.errors?.[0]?.message || "Medium integration token rejected")
  }
  return { id: data.data.id, username: data.data.username }
}

export const mediumPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const authorId = (metadata.author_id as string) || undefined
    if (!authorId) return { success: false, error: "Medium connection has no author id" }
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "Medium posts need a title" }

    const res = await fetch(`https://api.medium.com/v1/users/${authorId}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        title,
        contentFormat: "markdown",
        content: `# ${title}\n\n${request.description ?? request.caption ?? ""}`,
        tags: (request.tags ?? []).slice(0, 5),
        publishStatus: "public",
      }),
    })
    const data = (await res.json()) as { data?: { id: string; url: string }; errors?: Array<{ message: string }> }
    if (!res.ok || !data.data?.id) {
      return { success: false, error: data.errors?.[0]?.message || "Medium publish failed" }
    }
    return { success: true, platformPostId: data.data.id, platformPostUrl: data.data.url }
  },
}

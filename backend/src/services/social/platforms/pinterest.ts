import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Pinterest v5 — pins land on the board resolved at connect time
 * (`metadata.default_board`, the account's first board).
 */

const API = "https://api.pinterest.com/v5"

export async function fetchPinterestUser(
  accessToken: string,
): Promise<{ id: string; username: string; avatarUrl?: string; boardId?: string }> {
  const res = await fetch(`${API}/user_account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = (await res.json()) as { id?: string; username?: string; profile_image?: string; message?: string }
  if (!res.ok || !data.username) throw new Error(data.message || "Pinterest user lookup failed")

  const boardsRes = await fetch(`${API}/boards?page_size=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const boards = (await boardsRes.json()) as { items?: Array<{ id: string }> }

  return {
    id: data.id ?? data.username,
    username: data.username,
    avatarUrl: data.profile_image,
    boardId: boards.items?.[0]?.id,
  }
}

export const pinterestPublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const boardId = metadata.default_board as string | undefined
    if (!boardId) return { success: false, error: "Pinterest connection has no board — create a board first" }
    if (!request.mediaUrl) return { success: false, error: "Pinterest pins need an image" }

    const res = await fetch(`${API}/pins`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        board_id: boardId,
        title: request.title ?? request.caption?.split("\n")[0] ?? "",
        description: request.description ?? request.caption ?? "",
        media_source: { source_type: "image_url", url: request.mediaUrl },
      }),
    })
    const data = (await res.json()) as { id?: string; message?: string }
    if (!res.ok || !data.id) return { success: false, error: data.message || "Pinterest pin failed" }
    return {
      success: true,
      platformPostId: data.id,
      platformPostUrl: `https://www.pinterest.com/pin/${data.id}/`,
    }
  },
}

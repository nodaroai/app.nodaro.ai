/**
 * Shared fixtures for the HeyGen catalog tests (catalog.test.ts — the fill /
 * delta / chunk behaviour; catalog-shared-store.test.ts — the Redis snapshot,
 * lock and convergence behaviour).
 */
import type { vi } from "vitest"

export function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Route `fetch` for /v3/avatars/looks by ownership: each ownership gets its
 * pages served in order (by call count), other URLs fall through to `other`.
 * The catalog fetches the account's own (private) looks and the public
 * presets as two streams, so tests describe both.
 */
export function routeLooks(
  fetchMock: ReturnType<typeof vi.fn>,
  pages: { private?: unknown[]; public?: unknown[] },
  other?: (url: string) => Response | Promise<Response>,
): void {
  const served = { private: 0, public: 0 }
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (!url.includes("/v3/avatars/looks")) {
      if (other) return other(url)
      throw new Error("unexpected fetch: " + url)
    }
    const ownership = new URL(url).searchParams.get("ownership") === "private" ? "private" : "public"
    const list = pages[ownership] ?? [{ code: 0, message: "success", data: [] }]
    const page = list[Math.min(served[ownership], list.length - 1)]
    served[ownership]++
    return makeResponse(page)
  })
}

/** Drain a chain of already-resolved awaits (the store check + refresh lock
 *  are a handful of microtask hops; fake timers do not run those). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}

/** One /v3/avatars/looks page holding a single photo-avatar look. */
export function lookPage(id: string, next?: string) {
  return {
    code: 0,
    message: "success",
    data: [{ id, avatar_type: "photo_avatar", name: id, gender: "Female", preview_image_url: `https://cdn.example.com/${id}.jpg` }],
    ...(next ? { next_token: next, has_more: true } : {}),
  }
}

import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"
import { removeInfiniteItems } from "@/lib/optimistic-cache"
import type { GalleryItem } from "./use-gallery-queries"

/**
 * Admin moderation from the gallery itself: take several items out at once,
 * or block the creators who made them. Both are admin-only on the server
 * (POST /v1/gallery/remove, POST /v1/admin/gallery-moderation/creators);
 * the page only offers them to admins.
 */

type GalleryPage = { data: GalleryItem[]; nextCursor: string | null; totalCount?: number }

/** The most ids one request may carry (the server's limit). */
const CHUNK = 100

/** The ids in requests of at most {@link CHUNK}, one after another. */
async function inChunks<T>(ids: readonly string[], send: (chunk: string[]) => Promise<T>): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) results.push(await send(ids.slice(i, i + CHUNK)))
  return results
}

/** An error the server explained, with its code when it gave one. */
export class GalleryAdminError extends Error {
  constructor(readonly code: string | null, message: string) {
    super(message)
    this.name = "GalleryAdminError"
  }
}

export async function galleryAdminRequest<T>(url: string, init: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) throw new GalleryAdminError(json?.error?.code ?? null, json?.error?.message ?? `Request failed (${res.status})`)
  return json as T
}

/** Drop items from every cached gallery list (instant feedback), returning what to restore. */
/** Every cached gallery list: the public one and the admin moderation view. */
const LIST_KEYS = [["gallery", "list"], ["gallery", "admin-items"]] as const

function dropFromLists(qc: ReturnType<typeof useQueryClient>, ids: ReadonlySet<string>) {
  const previous = LIST_KEYS.flatMap((queryKey) => qc.getQueriesData<InfiniteData<GalleryPage>>({ queryKey }))
  for (const queryKey of LIST_KEYS) {
    qc.setQueriesData<InfiniteData<GalleryPage>>({ queryKey }, (data) =>
      removeInfiniteItems<"data", GalleryItem, GalleryPage>(data, "data", (item) => ids.has(item.id)),
    )
  }
  return previous
}

export function useBulkRemoveGalleryItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemIds }: { itemIds: readonly string[] }) => {
      const answers = await inChunks(itemIds, (jobIds) => galleryAdminRequest<{ removed: number }>("/v1/gallery/remove", { method: "POST", body: { jobIds } }))
      return { removed: answers.reduce((sum, answer) => sum + answer.removed, 0) }
    },
    onMutate: async ({ itemIds }) => {
      await qc.cancelQueries({ queryKey: queryKeys.gallery.all })
      return { previous: dropFromLists(qc, new Set(itemIds)) }
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}

/**
 * Block the creators of these items. Every item of theirs leaves the gallery,
 * not just these — so the lists are refetched rather than trimmed.
 */
export function useBlockGalleryCreatorsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemIds }: { itemIds: readonly string[] }) => {
      const answers = await inChunks(itemIds, (jobIds) =>
        galleryAdminRequest<{ blocked: number }>("/v1/admin/gallery-moderation/creators", { method: "POST", body: { jobIds } }),
      )
      return { blocked: answers.reduce((sum, answer) => sum + answer.blocked, 0) }
    },
    onMutate: async ({ itemIds }) => {
      await qc.cancelQueries({ queryKey: queryKeys.gallery.all })
      return { previous: dropFromLists(qc, new Set(itemIds)) }
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"
import { queryKeys } from "@/lib/query-keys"
import { galleryAdminRequest } from "@/hooks/queries/use-gallery-admin-queries"

/**
 * Admin → Gallery moderation: the banned words (each with its translations
 * and allowed phrases) and the blocked creators. Every change answers with
 * the whole list as saved, which replaces the cached one; the gallery lists
 * are refetched so the change shows there too.
 */

export interface GalleryWordEntry {
  readonly word: string
  readonly translations: readonly string[]
  readonly exceptions: readonly string[]
  /** Suggested automatically; they apply only once an admin approves them. */
  readonly suggestedExceptions?: readonly string[]
}

export interface GalleryBannedCreator {
  readonly userId: string
  readonly addedAt: string | null
  readonly email: string | null
  readonly name: string | null
}

/** A blocked email pattern and how many accounts it matches today. */
export interface GalleryBlockedPattern {
  readonly pattern: string
  readonly addedAt: string | null
  readonly matches: number
}

export interface GalleryModerationState {
  readonly words: readonly GalleryWordEntry[]
  readonly bannedUsers: readonly GalleryBannedCreator[]
  readonly emailPatterns?: readonly GalleryBlockedPattern[]
  /** Imported words whose suggestions are still being looked up. */
  readonly filling?: readonly string[]
}

/** Under the gallery's own key, so blocking from the gallery refreshes this page too. */
export const GALLERY_MODERATION_KEY = ["gallery", "moderation"] as const

export function useGalleryModeration() {
  return useQuery({
    queryKey: GALLERY_MODERATION_KEY,
    queryFn: () => galleryAdminRequest<GalleryModerationState>("/v1/admin/gallery-moderation", { method: "GET" }),
    staleTime: 10_000,
    // While imported words are still being looked up, keep the list fresh.
    refetchInterval: (query) => ((query.state.data?.filling?.length ?? 0) > 0 ? 5_000 : false),
  })
}

/** A gallery item and who made it — the admin view only. */
export interface AdminGalleryItem extends GalleryItem {
  readonly creator: { readonly userId: string; readonly email: string | null; readonly name: string | null } | null
}

type AdminGalleryPage = { data: AdminGalleryItem[]; nextCursor: string | null; totalCount?: number }

/** The public gallery as visitors see it, with each item's creator. */
export function useAdminGalleryItems(type: "all" | "image" | "video" | "audio") {
  return useInfiniteQuery({
    queryKey: ["gallery", "admin-items", type] as const,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30" })
      if (type !== "all") params.set("type", type)
      if (pageParam) params.set("cursor", pageParam)
      return galleryAdminRequest<AdminGalleryPage>(`/v1/admin/gallery-moderation/items?${params.toString()}`, { method: "GET" })
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

function useSaved<TVars, TResult extends Partial<GalleryModerationState>>(request: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      qc.setQueryData<GalleryModerationState>(GALLERY_MODERATION_KEY, (current) =>
        current
          ? { ...current, ...(result.words ? { words: result.words } : {}), ...(result.bannedUsers ? { bannedUsers: result.bannedUsers } : {}), ...(result.filling ? { filling: result.filling } : {}), ...(result.emailPatterns ? { emailPatterns: result.emailPatterns } : {}) }
          : current,
      )
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}

export function useAddGalleryWord() {
  return useSaved(({ word, language }: { word: string; language?: string }) =>
    galleryAdminRequest<{ words: GalleryWordEntry[]; suggested: boolean }>("/v1/admin/gallery-moderation/words", { method: "POST", body: { word, language } }),
  )
}

export function useImportGalleryWords() {
  return useSaved(({ words, language }: { words: readonly string[]; language?: string }) =>
    galleryAdminRequest<{ words: GalleryWordEntry[]; added: number; skipped: string[]; filling: string[] }>("/v1/admin/gallery-moderation/words/import", {
      method: "POST",
      body: { words, language },
    }),
  )
}

export interface GalleryWordEdit {
  readonly word: string
  readonly addTranslations?: readonly string[]
  readonly removeTranslations?: readonly string[]
  readonly addExceptions?: readonly string[]
  readonly removeExceptions?: readonly string[]
  readonly approveExceptions?: readonly string[]
  readonly dismissExceptions?: readonly string[]
}

export function useEditGalleryWord() {
  return useSaved((edit: GalleryWordEdit) =>
    galleryAdminRequest<{ words: GalleryWordEntry[] }>("/v1/admin/gallery-moderation/words", { method: "PATCH", body: edit }),
  )
}

export function useRemoveGalleryWord() {
  return useSaved(({ word }: { word: string }) =>
    galleryAdminRequest<{ words: GalleryWordEntry[] }>("/v1/admin/gallery-moderation/words/remove", { method: "POST", body: { word } }),
  )
}

export function useBlockCreatorByEmail() {
  return useSaved(({ email }: { email: string }) =>
    galleryAdminRequest<{ bannedUsers: GalleryBannedCreator[] }>("/v1/admin/gallery-moderation/creators", { method: "POST", body: { email } }),
  )
}

export function useUnblockCreator() {
  return useSaved(({ userId }: { userId: string }) =>
    galleryAdminRequest<{ bannedUsers: GalleryBannedCreator[] }>("/v1/admin/gallery-moderation/creators/remove", { method: "POST", body: { userId } }),
  )
}

export function useBlockEmailPattern() {
  return useSaved(({ pattern }: { pattern: string }) =>
    galleryAdminRequest<{ emailPatterns: GalleryBlockedPattern[] }>("/v1/admin/gallery-moderation/creators/patterns", { method: "POST", body: { pattern } }),
  )
}

export function useUnblockEmailPattern() {
  return useSaved(({ pattern }: { pattern: string }) =>
    galleryAdminRequest<{ emailPatterns: GalleryBlockedPattern[] }>("/v1/admin/gallery-moderation/creators/patterns/remove", { method: "POST", body: { pattern } }),
  )
}

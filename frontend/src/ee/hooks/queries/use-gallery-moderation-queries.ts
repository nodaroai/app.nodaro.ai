import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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

export interface GalleryModerationState {
  readonly words: readonly GalleryWordEntry[]
  readonly bannedUsers: readonly GalleryBannedCreator[]
}

/** Under the gallery's own key, so blocking from the gallery refreshes this page too. */
export const GALLERY_MODERATION_KEY = ["gallery", "moderation"] as const

export function useGalleryModeration() {
  return useQuery({
    queryKey: GALLERY_MODERATION_KEY,
    queryFn: () => galleryAdminRequest<GalleryModerationState>("/v1/admin/gallery-moderation", { method: "GET" }),
    staleTime: 10_000,
  })
}

function useSaved<TVars, TResult extends Partial<GalleryModerationState>>(request: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: (result) => {
      qc.setQueryData<GalleryModerationState>(GALLERY_MODERATION_KEY, (current) =>
        current
          ? { ...current, ...(result.words ? { words: result.words } : {}), ...(result.bannedUsers ? { bannedUsers: result.bannedUsers } : {}) }
          : current,
      )
      qc.invalidateQueries({ queryKey: queryKeys.gallery.all })
    },
  })
}

export function useAddGalleryWord() {
  return useSaved(({ word }: { word: string }) =>
    galleryAdminRequest<{ words: GalleryWordEntry[]; suggested: boolean }>("/v1/admin/gallery-moderation/words", { method: "POST", body: { word } }),
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

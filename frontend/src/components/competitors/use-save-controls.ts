import { useState } from "react"
import { toast } from "sonner"
import type { SavedPostSource, SocialPost } from "@nodaro/shared"
import { useSavedPostLookup, useSavedPostMutations } from "@/hooks/queries/use-saved-posts-queries"
import { useT } from "@/lib/i18n"
import type { SaveControls } from "./action-card-view"

/**
 * Save-to-Inspiration bookmarks for a set of posts: which are saved (one
 * lookup), and a toggle that saves or removes. What this screen changed is
 * kept locally so a bookmark does not flick back while the lookup refetches.
 */
export function useSaveControls(postIds: readonly string[], source: SavedPostSource): SaveControls {
  const t = useT()
  const lookup = useSavedPostLookup(postIds, postIds.length > 0)
  const { save, remove } = useSavedPostMutations()
  const [changed, setChanged] = useState<Readonly<Record<string, string | null>>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const saveIdOf = (postId: string): string | null => (postId in changed ? (changed[postId] ?? null) : (lookup.data?.get(postId) ?? null))

  const toggle = async (post: SocialPost) => {
    const saveId = saveIdOf(post.id)
    setBusy(post.id)
    try {
      if (saveId) {
        await remove.mutateAsync(saveId)
        setChanged((cur) => ({ ...cur, [post.id]: null }))
        toast.success(t("social.removedFromWall"))
      } else {
        const created = await save.mutateAsync({ post, source })
        setChanged((cur) => ({ ...cur, [post.id]: created.id }))
        toast.success(t("social.savedToWall"))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(saveId ? "apiErr.deleteSavedPost" : "apiErr.savePost"))
    } finally {
      setBusy(null)
    }
  }

  return {
    isSaved: (postId) => saveIdOf(postId) !== null,
    isBusy: (postId) => busy === postId,
    toggle: (post) => void toggle(post),
  }
}

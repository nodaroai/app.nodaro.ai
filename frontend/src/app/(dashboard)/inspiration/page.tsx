import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Bookmark, Loader2, Search, X } from "lucide-react"
import { toast } from "sonner"
import { SOCIAL_PLATFORMS, type SavedPost, type SocialPlatform } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SavedPostCard } from "@/components/research/saved-post-card"
import { SavedPostEditDialog } from "@/components/research/saved-post-edit-dialog"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useSavedPostMutations, useSavedPostsWall } from "@/hooks/queries/use-saved-posts-queries"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const SEARCH_DELAY_MS = 300

/**
 * The inspiration wall: every post the person saved from Social Search, with
 * their notes and tags. Filter by platform, tag or words; change a note or
 * tags; remove a save.
 */
export default function InspirationPage() {
  const t = useT()
  const [platform, setPlatform] = useState<SocialPlatform | undefined>(undefined)
  const [tag, setTag] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<SavedPost | null>(null)
  const [removing, setRemoving] = useState<SavedPost | null>(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search])

  const wall = useSavedPostsWall({ platform, tag, q: q || undefined })
  const { update, remove } = useSavedPostMutations()
  const saves = useMemo(() => wall.data?.pages.flatMap((page) => page.data) ?? [], [wall.data])
  const filtered = platform !== undefined || tag !== undefined || q !== ""

  const submitEdit = (input: { note: string; tags: string[] }) => {
    if (!editing) return
    update.mutate(
      { id: editing.id, input },
      {
        onSuccess: () => {
          toast.success(t("inspiration.updated"))
          setEditing(null)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.updateSavedPost")),
      },
    )
  }

  const confirmRemove = (save: SavedPost) => {
    remove.mutate(save.id, {
      onSuccess: () => toast.success(t("social.removedFromWall")),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.deleteSavedPost")),
    })
  }

  return (
    <div className="container mx-auto max-w-7xl p-6">
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-3">
          <Bookmark className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("inspiration.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("inspiration.description")}</p>
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("inspiration.searchPlaceholder")}
            aria-label={t("inspiration.searchPlaceholder")}
            className="ps-9"
            dir="auto"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PlatformChip active={platform === undefined} onClick={() => setPlatform(undefined)}>
            {t("common.all")}
          </PlatformChip>
          {SOCIAL_PLATFORMS.map((p) => (
            <PlatformChip key={p} active={platform === p} onClick={() => setPlatform(p)}>
              {SOCIAL_PLATFORM_META[p].icon("h-3.5 w-3.5")}
              {SOCIAL_PLATFORM_META[p].name}
            </PlatformChip>
          ))}
          {tag !== undefined && (
            <button
              type="button"
              onClick={() => setTag(undefined)}
              aria-label={t("inspiration.clearTag", { tag })}
              className="ms-2 flex items-center gap-1 rounded-full bg-[#FF0073] px-2.5 py-1 text-[12px] font-bold text-white"
              dir="auto"
            >
              #{tag}
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {wall.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : wall.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t("apiErr.loadSavedPosts")}
        </div>
      ) : saves.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Bookmark className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="max-w-md text-sm text-muted-foreground">{filtered ? t("inspiration.noMatches") : t("inspiration.empty")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {saves.map((save) => (
              <SavedPostCard
                key={save.id}
                save={save}
                now={now}
                busy={(update.isPending && update.variables?.id === save.id) || (remove.isPending && remove.variables === save.id)}
                onEdit={() => setEditing(save)}
                onRemove={() => setRemoving(save)}
                onTag={(next) => setTag(next)}
              />
            ))}
          </div>
          {wall.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={() => void wall.fetchNextPage()} disabled={wall.isFetchingNextPage}>
                {wall.isFetchingNextPage && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("inspiration.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}

      <SavedPostEditDialog
        save={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSubmit={submitEdit}
        busy={update.isPending}
      />
      <DeleteConfirmationDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) confirmRemove(removing)
        }}
        title={t("inspiration.removeTitle")}
        description={t("inspiration.removeDesc")}
        confirmLabel={t("common.remove")}
      />
    </div>
  )
}

function PlatformChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

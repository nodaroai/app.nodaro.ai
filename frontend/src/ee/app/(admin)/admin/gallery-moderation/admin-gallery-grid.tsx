import { useCallback, useMemo, useState } from "react"
import { CheckSquare, EyeOff, Loader2, Square } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { cn } from "@/lib/utils"
import { useT, tx, type MessageKey } from "@/lib/i18n"
import { AudioCard, TypeBadge, VideoCard, formatGalleryDate } from "@/components/gallery/gallery-media"
import { GallerySelectionBar } from "@/components/gallery/gallery-admin-bar"
import { GalleryBlockCreatorButton } from "@/components/gallery/gallery-block-creator-button"
import { useBulkRemoveGalleryItemsMutation } from "@/hooks/queries/use-gallery-admin-queries"
import { useAdminGalleryItems, type AdminGalleryItem } from "@/ee/hooks/queries/use-gallery-moderation-queries"

type MediaFilter = "all" | "image" | "video" | "audio"

const FILTERS: readonly { readonly value: MediaFilter; readonly labelKey: MessageKey }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "image", labelKey: "assetlib.tabImages" },
  { value: "video", labelKey: "assetlib.tabVideos" },
  { value: "audio", labelKey: "assetlib.tabAudio" },
]

function ItemCard({
  item,
  selected,
  onToggle,
}: {
  readonly item: AdminGalleryItem
  readonly selected: boolean
  readonly onToggle: (item: AdminGalleryItem) => void
}) {
  const t = useT()
  const hide = useBulkRemoveGalleryItemsMutation()
  const creator = item.creator?.email ?? item.creator?.name ?? t("galleryModeration.unknownCreator")

  async function hideItem() {
    try {
      await hide.mutateAsync({ itemIds: [item.id] })
      toast.success(tx("gallery.itemRemoved"))
    } catch {
      toast.error(tx("gallery.removeFailed"))
    }
  }

  return (
    <li className={cn("overflow-hidden rounded-lg border bg-card", selected ? "border-[#ff0073] ring-2 ring-[#ff0073]" : "border-zinc-200 dark:border-zinc-800")}>
      <button type="button" onClick={() => onToggle(item)} className="relative block aspect-square w-full" title={item.prompt ?? undefined} aria-pressed={selected}>
        {item.type === "image" ? (
          <CachedImage src={item.outputUrl} alt="" className="h-full w-full object-cover" loading="lazy" thumbnail />
        ) : item.type === "video" ? (
          <VideoCard item={item} />
        ) : (
          <AudioCard url={item.outputUrl} />
        )}
        <span className="absolute top-2 start-2 z-[4] rounded bg-black/50 p-0.5" aria-hidden>
          {selected ? <CheckSquare className="h-5 w-5 text-[#ff0073]" /> : <Square className="h-5 w-5 text-white" />}
        </span>
      </button>
      <div className="space-y-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <bdi className="truncate text-xs font-medium" title={item.creator?.userId}>
            {creator}
          </bdi>
          <TypeBadge type={item.type} />
        </div>
        {item.prompt && (
          <p className="line-clamp-2 text-[11px] text-muted-foreground" dir="auto" title={item.prompt}>
            {item.prompt}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={hide.isPending} onClick={() => void hideItem()}>
            {hide.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin me-1" /> : <EyeOff className="h-3.5 w-3.5 me-1" />}
            {t("galleryModeration.hideItem")}
          </Button>
          {item.creator && <GalleryBlockCreatorButton item={item} onBlocked={() => undefined} />}
          <span className="ms-auto text-[10px] text-muted-foreground">{formatGalleryDate(item.createdAt)}</span>
        </div>
      </div>
    </li>
  )
}

/**
 * The public gallery as visitors see it, inside the admin page: who made each
 * item, hide one, hide many, or block a creator — which hides all their work.
 */
export function AdminGalleryGrid() {
  const t = useT()
  const [filter, setFilter] = useState<MediaFilter>("all")
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useAdminGalleryItems(filter)
  const items = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data])

  const toggle = useCallback((item: AdminGalleryItem) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }, [])
  const clear = useCallback(() => setSelected(new Set()), [])

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-1 rounded-full border border-zinc-200 dark:border-zinc-800 p-1 bg-card w-fit">
        {FILTERS.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            className={cn("rounded-full px-3 py-1 text-sm font-medium", filter === value ? "bg-[#ff0073] text-white" : "text-muted-foreground hover:text-foreground")}
            onClick={() => {
              setFilter(value)
              clear()
            }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : isError ? (
        <p className="text-sm text-red-600">{t("galleryModeration.loadFailed")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("galleryModeration.noItems")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={toggle} />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}
          {t("galleryModeration.loadMore")}
        </Button>
      )}

      {selected.size > 0 && (
        <GallerySelectionBar
          selectedIds={selected}
          shownCount={items.length}
          canBlock
          onSelectAllShown={() => setSelected(new Set(items.map((item) => item.id)))}
          onClear={clear}
          onDone={clear}
        />
      )}
    </div>
  )
}

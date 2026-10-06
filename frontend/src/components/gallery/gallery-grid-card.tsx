import { memo } from "react"
import { CheckSquare, Flag, Heart, Square, Trash2 } from "lucide-react"
import { isMultiUser } from "@/lib/edition"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"
import { useT } from "@/lib/i18n"
import { PreviewBadge } from "@/components/render/preview-badge"
import { AudioCard, TYPE_LABEL_KEY, TypeBadge, VideoCard, formatGalleryDate } from "./gallery-media"

interface GalleryGridCardProps {
  readonly item: GalleryItem
  readonly index: number
  readonly isFavorited: boolean
  readonly showFavorite: boolean
  readonly isAdmin: boolean
  /** Admin selection mode: a click selects the card instead of opening it. */
  readonly selecting: boolean
  readonly selected: boolean
  readonly onSelect: (index: number) => void
  readonly onToggleSelected: (item: GalleryItem) => void
  readonly onToggleFavorite: (item: GalleryItem, e?: React.MouseEvent) => void
  readonly onReport: (item: GalleryItem, e?: React.MouseEvent) => void
  readonly onDelete: (item: GalleryItem, e?: React.MouseEvent) => void
}

// Memoized so selection/favorite changes only re-render the affected card,
// not every card in the (non-virtualized, growing) infinite-scroll grid.
export const GalleryGridCard = memo(function GalleryGridCard({
  item,
  index,
  isFavorited,
  showFavorite,
  isAdmin,
  selecting,
  selected,
  onSelect,
  onToggleSelected,
  onToggleFavorite,
  onReport,
  onDelete,
}: GalleryGridCardProps) {
  const t = useT()
  const activate = () => (selecting ? onToggleSelected(item) : onSelect(index))
  const overlay = (
    <>
      {/* A render made at proxy quality (the owner's own view only): always visible, not on hover. */}
      {item.preview && <PreviewBadge className={cn("absolute top-2 z-[3] text-[10px]", selecting ? "start-9" : "start-2")} />}

      {/* Overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity z-[3]">
        <div className="flex items-center justify-between">
          <TypeBadge type={item.type} />
          <span className="text-white/60 text-xs">
            {formatGalleryDate(item.createdAt)}
          </span>
        </div>
      </div>

      {selecting ? (
        <span className="absolute top-2 start-2 z-[4] rounded bg-black/50 p-0.5" aria-hidden>
          {selected ? <CheckSquare className="h-5 w-5 text-[#ff0073]" /> : <Square className="h-5 w-5 text-white" />}
        </span>
      ) : (
        /* Action buttons (top-right corner on hover) */
        <div className="absolute top-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-[3]">
          {showFavorite && (
            <button
              onClick={(e) => onToggleFavorite(item, e)}
              className="rounded-full bg-black/50 p-1.5 hover:bg-black/70 transition-colors"
              title={isFavorited ? t("templates.unfavorite") : t("templates.favorite")}
            >
              <Heart className={cn("h-3.5 w-3.5", isFavorited ? "text-[#ff0073] fill-[#ff0073]" : "text-white")} />
            </button>
          )}
          {/* Reports are reviewed in the admin panel, which single-user
              editions don't have — the POST succeeded and said "Thank you!"
              while nothing could ever look at it (community grind, 2026-08-14). */}
          {isMultiUser() && (
            <button
              onClick={(e) => onReport(item, e)}
              className="rounded-full bg-black/50 p-1.5 hover:bg-black/70 transition-colors"
              title={t("gallery.report")}
            >
              <Flag className="h-3.5 w-3.5 text-white" />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={(e) => onDelete(item, e)}
              className="rounded-full bg-red-500/70 p-1.5 hover:bg-red-500/90 transition-colors"
              title={t("gallery.removeFromGallery")}
            >
              <Trash2 className="h-3.5 w-3.5 text-white" />
            </button>
          )}
        </div>
      )}
    </>
  )

  return (
    <div
      role={selecting ? "checkbox" : "button"}
      aria-checked={selecting ? selected : undefined}
      aria-label={t(selecting ? "gallery.selectItem" : "gallery.viewItem", { type: t(TYPE_LABEL_KEY[item.type]) })}
      tabIndex={0}
      className={cn(
        "group relative aspect-square rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-card hover:ring-2 hover:ring-[#ff0073]/30 transition-all cursor-pointer",
        selected && "ring-4 ring-[#ff0073] hover:ring-[#ff0073]",
      )}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          activate()
        }
      }}
    >
      {item.type === "image" ? (
        <>
          <CachedImage
            src={item.outputUrl}
            alt=""
            className="w-full h-full object-cover"
            {...(index < 10 ? (index === 0 ? { fetchPriority: "high" } : {}) : { loading: "lazy" })}
            thumbnail
          />
          {overlay}
        </>
      ) : item.type === "video" ? (
        <VideoCard item={item} priority={index < 10}>{overlay}</VideoCard>
      ) : (
        <>
          <AudioCard url={item.outputUrl} />
          {overlay}
        </>
      )}
    </div>
  )
})

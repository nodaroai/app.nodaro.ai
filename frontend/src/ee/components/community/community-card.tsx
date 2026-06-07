import { Copy, Heart, Sparkles } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { formatCount } from "@/lib/template-utils"
import type { CommunityCard as CommunityCardData } from "@/lib/api"

interface CommunityCardProps {
  item: CommunityCardData
  onClick: () => void
}

export function CommunityCard({ item, onClick }: CommunityCardProps) {
  const thumbnail = item.preview_media_url ?? item.preview_images[0]?.url ?? null

  return (
    <div
      className="group relative bg-card border border-border rounded-xl overflow-hidden hover:border-zinc-400 dark:hover:border-zinc-600 transition-all cursor-pointer"
      onClick={onClick}
    >
      {/* Preview media (square — portraits/objects/locations vary, square keeps the grid even) */}
      <div className="relative aspect-square bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 overflow-hidden">
        {thumbnail ? (
          <CachedImage
            src={thumbnail}
            alt={item.title}
            className="w-full h-full object-cover"
            thumbnail
            thumbnailWidth={400}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}
      </div>

      {/* Default: title + creator */}
      <div className="p-3">
        <h3 className="text-sm font-semibold text-foreground truncate">{item.title}</h3>
        {item.creator_display_name && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            by {item.creator_display_name}
          </p>
        )}
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 space-y-2">
        <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>

        {item.description && (
          <p className="text-xs text-white/70 line-clamp-2">{item.description}</p>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 font-medium"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[10px] text-white/50">+{item.tags.length - 3} more</span>
            )}
          </div>
        )}

        {/* Clone + favorite counts */}
        <div className="flex items-center gap-3 text-xs text-white/70">
          <span className="flex items-center gap-1">
            <Copy className="h-3 w-3" />
            {formatCount(item.clone_count)}
          </span>
          {item.favorite_count > 0 && (
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />
              {formatCount(item.favorite_count)}
            </span>
          )}
        </div>

        {item.creator_display_name && (
          <p className="text-[10px] text-white/50 truncate">by {item.creator_display_name}</p>
        )}
      </div>
    </div>
  )
}

/** Skeleton card for loading state */
export function CommunityCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-square bg-zinc-200 dark:bg-zinc-800" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
      </div>
    </div>
  )
}

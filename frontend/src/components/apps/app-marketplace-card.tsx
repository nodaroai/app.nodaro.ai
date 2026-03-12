import { Heart, Play, Sparkles, Coins } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { AppBrowseCard } from "@/lib/api"
import { APP_CATEGORIES, OUTPUT_TYPE_COLORS, CATEGORY_COLORS } from "@/lib/app-categories"

interface AppMarketplaceCardProps {
  app: AppBrowseCard
  isFavorited: boolean
  onToggleFavorite: (appId: string) => void
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function AppMarketplaceCard({ app, isFavorited, onToggleFavorite }: AppMarketplaceCardProps) {
  const navigate = useNavigate()
  const categoryLabel = APP_CATEGORIES.find((c) => c.value === app.category)?.label ?? "Other"
  const categoryColor = CATEGORY_COLORS[app.category] ?? CATEGORY_COLORS.other

  return (
    <div
      className="group bg-card border border-border rounded-xl overflow-hidden hover:border-zinc-400 dark:hover:border-zinc-600 transition-all cursor-pointer"
      onClick={() => navigate(`/app/${app.slug}`)}
    >
      {/* Preview media (16:9) */}
      <div className="relative aspect-video bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 overflow-hidden">
        {app.previewMediaUrl ? (
          app.previewMediaType === "video" ? (
            <video
              src={app.previewMediaUrl}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
            />
          ) : (
            <img
              src={app.previewMediaUrl}
              alt={app.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}

        {/* Overlay badges on hover */}
        {app.supportsRemix && (
          <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-[#ff0073]/90 text-white font-medium">
            RemX
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Name + description */}
        <div>
          <h3 className="text-sm font-semibold text-foreground truncate">{app.name}</h3>
          {app.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{app.description}</p>
          )}
        </div>

        {/* Category + output type badges */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", categoryColor)}>
            {categoryLabel}
          </span>
          {app.outputTypes.slice(0, 3).map((t) => (
            <span
              key={t}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border font-medium capitalize",
                OUTPUT_TYPE_COLORS[t] ?? "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
              )}
            >
              {t}
            </span>
          ))}
        </div>

        {/* Tags */}
        {app.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {app.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {app.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{app.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Bottom row: credits, runs, favorite */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {app.estimatedCredits} CR
            </span>
            <span className="flex items-center gap-1">
              <Play className="h-3 w-3" />
              {formatCount(app.totalRunCount)}
            </span>
          </div>

          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(app.id)
            }}
          >
            <Heart
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                isFavorited && "fill-[#ff0073] text-[#ff0073]",
              )}
            />
            {app.favoriteCount > 0 && <span>{formatCount(app.favoriteCount)}</span>}
          </button>
        </div>

        {/* Creator */}
        {app.creatorDisplayName && (
          <p className="text-[10px] text-muted-foreground truncate">
            by {app.creatorDisplayName}
          </p>
        )}
      </div>
    </div>
  )
}

/** Skeleton card for loading state */
export function AppMarketplaceCardSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-video bg-zinc-200 dark:bg-zinc-800" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
        <div className="flex gap-1">
          <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
          <div className="h-4 w-12 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
        </div>
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
      </div>
    </div>
  )
}

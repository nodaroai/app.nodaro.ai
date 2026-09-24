import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Heart, Flag, Tag } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CachedImage } from "@/components/ui/cached-image"
import { cn } from "@/lib/utils"
import {
  cloneCommunityListing,
  getCommunityListing,
  toggleCommunityFavorite,
  type CommunityCard,
} from "@/lib/api"
import { formatCount } from "@/lib/template-utils"
import { tx, useT, type MessageKey } from "@/lib/i18n"
import { ReportDialog } from "./report-dialog"

const ENTITY_TYPE_LABEL_KEYS: Record<CommunityCard["entity_type"], MessageKey> = {
  character: "assetlib.typeCharacter",
  location: "assetlib.typeLocation",
  object: "assetlib.typeObject",
  creature: "assetlib.typeCreature",
}

interface CommunityPreviewModalProps {
  item: CommunityCard | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommunityPreviewModal({ item, open, onOpenChange }: CommunityPreviewModalProps) {
  const t = useT()
  const qc = useQueryClient()
  const [isCloning, setIsCloning] = useState(false)
  const [isFavoriting, setIsFavoriting] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  // Fetch fresh detail (counts, full image set) when opened. Falls back to the
  // card data passed in while loading or on error.
  const { data: detail } = useQuery({
    queryKey: ["community", "detail", item?.slug],
    queryFn: () => getCommunityListing(item!.slug),
    enabled: open && !!item?.slug,
  })

  // Prefer fresh detail, fall back to the list card so the modal renders instantly.
  const view: CommunityCard | null = detail?.data ?? item

  const handleClone = async () => {
    if (!view) return
    setIsCloning(true)
    try {
      await cloneCommunityListing(view.id, view.entity_type)
      toast.success(tx("community.clonedToLibrary"))
      // Clone lands in the user's asset library (character/location/object).
      // Invalidate the whole asset tree by prefix so every project/library view refreshes.
      qc.invalidateQueries({ queryKey: ["assets"] })
      qc.invalidateQueries({ queryKey: ["community"] })
      onOpenChange(false)
    } catch (err) {
      // StorageExceededError and other API errors carry a human message via throwApiError.
      toast.error(err instanceof Error ? err.message : tx("community.cloneFailed"))
    } finally {
      setIsCloning(false)
    }
  }

  const handleFavorite = async () => {
    if (!view) return
    setIsFavoriting(true)
    try {
      const { favorited } = await toggleCommunityFavorite(view.id)
      toast.success(favorited ? tx("community.addedToFavorites") : tx("community.removedFromFavorites"))
      qc.invalidateQueries({ queryKey: ["community"] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("community.favoriteFailed"))
    } finally {
      setIsFavoriting(false)
    }
  }

  if (!view) return null

  const images =
    view.preview_images.length > 0
      ? view.preview_images
      : view.preview_media_url
        ? [{ url: view.preview_media_url }]
        : []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{view.title}</DialogTitle>
            <DialogDescription>
              {view.creator_display_name
                ? t("preview.by", { name: view.creator_display_name })
                : t("community.listing")}
            </DialogDescription>
          </DialogHeader>

          {/* Image grid */}
          {images.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div
                  key={`${img.url}-${i}`}
                  className="relative aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-900 border border-border"
                >
                  <CachedImage
                    src={img.url}
                    alt={`${view.title} ${i + 1}`}
                    className="w-full h-full object-cover"
                    thumbnail
                    thumbnailWidth={512}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t("community.noPreviewImages")}
            </div>
          )}

          {/* Description */}
          {view.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{view.description}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1 capitalize">{t(ENTITY_TYPE_LABEL_KEYS[view.entity_type])}</span>
            <span className="flex items-center gap-1">
              <Copy className="h-3.5 w-3.5" />
              {t("templates.clones", { n: formatCount(view.clone_count) })}
            </span>
            {view.favorite_count > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" />
                {t("templates.favorites", { n: formatCount(view.favorite_count) })}
              </span>
            )}
          </div>

          {/* Tags */}
          {view.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {view.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 rounded-full bg-[#ff0073]/10 text-[#ff0073] border border-[#ff0073]/20 font-medium"
                >
                  <Tag className="inline h-3 w-3 me-0.5 -mt-px" />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleFavorite}
              disabled={isFavoriting}
              aria-label={t("community.toggleFavorite")}
            >
              <Heart className={cn("h-4 w-4", isFavoriting && "opacity-50")} />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setReportOpen(true)}
              aria-label={t("community.reportListing")}
            >
              <Flag className="h-4 w-4" />
            </Button>

            <Button
              className="flex-1 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              onClick={handleClone}
              disabled={isCloning}
            >
              {isCloning ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin me-2" />
              ) : (
                <Copy className="h-4 w-4 me-2" />
              )}
              {t("community.cloneToLibrary")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReportDialog listingId={view.id} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  )
}

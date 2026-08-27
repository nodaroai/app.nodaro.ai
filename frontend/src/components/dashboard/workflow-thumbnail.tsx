import { isVideoUrl } from "@/lib/media-type"
import { CachedImage } from "@/components/ui/cached-image"
import { PreviewVideo } from "@/components/ui/preview-video"
import { WorkflowCoverPlaceholder } from "./workflow-cover-placeholder"

interface WorkflowThumbnailProps {
  readonly thumbnailUrl: string | null
  /**
   * Distinct node types in the flow, used to pick the placeholder's look when
   * no cover has been chosen. Absent (the column has not reached this
   * environment yet, or the caller does not have it) reads the same as an empty
   * flow — one consistent default rather than a wrong guess.
   */
  readonly nodeTypes?: readonly string[] | null
  /** Above-the-fold thumbnail (first row of a grid). Fetches the image at high
   *  priority so it can be the LCP element without waiting behind other
   *  requests. See CachedImage's `priority` prop. */
  readonly priority?: boolean
}

export function WorkflowThumbnail({ thumbnailUrl, nodeTypes, priority }: WorkflowThumbnailProps) {
  return (
    <div className="aspect-[4/3] bg-muted/50 overflow-hidden">
      {thumbnailUrl ? (
        isVideoUrl(thumbnailUrl) ? (
          // Shared hover-to-play primitive: preload="metadata" paints the first
          // frame so the tile is never blank until hover (the reported bug).
          <PreviewVideo src={thumbnailUrl} className="w-full h-full object-cover" />
        ) : (
          <CachedImage
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            thumbnail
            // The card grids render each tile ~250–320px CSS-wide. optimizedImageUrl
            // requests a Cloudflare width in CSS pixels with NO devicePixelRatio
            // multiplier, so a 2× (retina) display upscales the source ~2× and the
            // cover looks soft. 640 = the widest tile (~320px) at DPR 2, crisp on
            // retina across every workflow-card grid while staying one cached variant.
            thumbnailWidth={640}
            priority={priority}
          />
        )
      ) : (
        <WorkflowCoverPlaceholder nodeTypes={nodeTypes} />
      )}
    </div>
  )
}

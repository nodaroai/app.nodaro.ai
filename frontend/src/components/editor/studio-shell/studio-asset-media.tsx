import { optimizedImageUrl } from "@/lib/image"
import { useMediaAspectRatio } from "./use-media-aspect"

interface StudioAssetMediaProps {
  readonly url: string
  readonly kind?: "image" | "video"
  readonly alt?: string
  /** Fallback container ratio (width/height) while the real media aspect is
   *  probed. Pass the asset-type default (e.g. 0.5625 for 9:16 full-body). */
  readonly fallbackAspect?: number
  /** Container classes (rounding, bg, border…). aspect-ratio is applied inline. */
  readonly className?: string
  /** object-fit utility; defaults to cover+top so any residual crop comes off the
   *  bottom, never the head. */
  readonly fit?: string
}

/**
 * Studio asset thumbnail sized to the REAL media aspect ratio (see
 * useMediaAspectRatio). Replaces the per-studio hardcoded `aspect-square` /
 * `aspect-[3/4]` / `aspect-video` containers that cropped full-body and
 * non-default assets. Renders an image (default) or a video (`kind="video"`).
 */
export function StudioAssetMedia({
  url,
  kind = "image",
  alt,
  fallbackAspect = 1,
  className,
  fit = "object-cover object-top",
}: StudioAssetMediaProps) {
  const { ratio, onVideoLoadedMetadata } = useMediaAspectRatio(
    url,
    kind,
    fallbackAspect,
  )
  return (
    <div className={className} style={{ aspectRatio: ratio }}>
      {kind === "video" ? (
        <video
          src={url}
          className={`w-full h-full ${fit}`}
          muted
          playsInline
          loop
          preload="metadata"
          onLoadedMetadata={onVideoLoadedMetadata}
        />
      ) : (
        <img
          src={optimizedImageUrl(url)}
          alt={alt}
          className={`w-full h-full ${fit}`}
        />
      )}
    </div>
  )
}

// A face mesh illustration (Admin → Nodaro Motion: the "Face mesh lines"
// choices and the layer switches): a depth face with the lines drawn
// (`face-mesh-thumbnails.ts`). Opaque gray on a border, so it reads the same in
// the light and dark themes. Beside a label that already names it, it is
// decorative (`decorative`: empty alt, hidden from a screen reader).

import { cn } from "@/lib/utils"
import type { FaceMeshThumbnail as Thumbnail } from "../face-mesh-thumbnails"

interface Props {
  readonly thumbnail: Thumbnail
  /** CSS pixels, square. */
  readonly size?: number
  readonly decorative?: boolean
  readonly className?: string
}

export function FaceMeshThumbnail({ thumbnail, size = 96, decorative = false, className }: Props) {
  if (!thumbnail.src) return null
  return (
    <img
      src={thumbnail.src}
      alt={decorative ? "" : thumbnail.alt}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-testid="face-mesh-thumbnail"
      className={cn("shrink-0 rounded-md border border-border bg-muted object-cover", className)}
      style={{ width: size, height: size }}
    />
  )
}

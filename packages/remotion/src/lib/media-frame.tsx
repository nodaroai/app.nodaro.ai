import { Img } from "remotion"

/** Show media only when a URL is present and it hasn't failed to load; else fall back. */
export function chooseMediaRender(src: string | undefined, hasError: boolean): "media" | "fallback" {
  return src && !hasError ? "media" : "fallback"
}

/**
 * CDN-gated raster image (Remotion <Img>) with a fit mode and onError. The
 * entrance animation (opacity/scale) always lives on the CALLER's outer
 * wrapper, never here — applying it on the inner <Img> compounds opacity².
 * Pass width/height for a fixed box (freeform element) OR maxWidth/maxHeight
 * for a contain-box (logo lockup); undefined style keys are omitted by React.
 */
export function MediaFrame(props: {
  src: string
  fit: "contain" | "cover"
  width?: number
  height?: number
  maxWidth?: number
  maxHeight?: number
  radius?: number
  onError?: () => void
}) {
  const { src, fit, width, height, maxWidth, maxHeight, radius, onError } = props
  return (
    <Img
      src={src}
      onError={onError}
      style={{ width, height, maxWidth, maxHeight, objectFit: fit, borderRadius: radius }}
    />
  )
}

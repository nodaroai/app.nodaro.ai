import { useCallback, useEffect, useRef, useState } from "react"
import { parseAspectRatio, type CropState } from "./utils"
import { RECT_HANDLES, clampRect, dragRect, eventClientXY, isCornerHandle, isEdgeHandle, type RectDrag } from "./rect-handles"
import { useT } from "@/lib/i18n"

interface CropPanelProps {
  mediaUrl: string
  mediaType: "image" | "video"
  naturalWidth: number
  naturalHeight: number
  aspectRatio: string
  crop: CropState | null
  onCropChange: (crop: CropState) => void
  onDisplaySizeChange?: (w: number, h: number) => void
  onAspectRatioChange?: (ratio: string) => void
  videoRef?: React.RefObject<HTMLVideoElement | null>
}

const MIN_CROP_SIZE = 20

type DragType = RectDrag | null

export function CropPanel({
  mediaUrl,
  mediaType,
  naturalWidth,
  naturalHeight,
  aspectRatio,
  crop,
  onCropChange,
  onDisplaySizeChange,
  onAspectRatioChange,
  videoRef,
}: CropPanelProps) {
  const t = useT()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [dragType, setDragType] = useState<DragType>(null)
  const dragStartRef = useRef<{ x: number; y: number; crop: CropState } | null>(null)

  if (!naturalWidth || !naturalHeight) return null

  const onDisplaySizeRef = useRef(onDisplaySizeChange)
  onDisplaySizeRef.current = onDisplaySizeChange

  // Create ResizeObserver eagerly (not in useEffect) so it's ready for callback refs
  const observerRef = useRef<ResizeObserver | null>(null)
  if (!observerRef.current) {
    observerRef.current = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        setImgSize((prev) => (prev.w === Math.round(width) && prev.h === Math.round(height)) ? prev : { w: Math.round(width), h: Math.round(height) })
        onDisplaySizeRef.current?.(Math.round(width), Math.round(height))
      }
    })
  }
  useEffect(() => () => observerRef.current?.disconnect(), [])

  const observerTargetRef = useRef<HTMLElement | null>(null)
  const attachObserver = useCallback((el: HTMLElement | null) => {
    if (observerTargetRef.current) observerRef.current?.unobserve(observerTargetRef.current)
    observerTargetRef.current = el
    if (el) observerRef.current?.observe(el)
  }, [])

  useEffect(() => {
    if (!crop && imgSize.w > 0 && imgSize.h > 0) {
      onCropChange({ x: 0, y: 0, width: imgSize.w, height: imgSize.h, zoom: 1, panX: 0, panY: 0 })
    }
  }, [crop, imgSize.w, imgSize.h, onCropChange])

  const lockedRatio = parseAspectRatio(aspectRatio)
  const effectiveRatio = aspectRatio === "original" ? naturalWidth / naturalHeight : lockedRatio
  useEffect(() => {
    if (crop && imgSize.w > 0 && effectiveRatio !== null) {
      if (Math.abs(crop.width / crop.height - effectiveRatio) > 0.02) {
        onCropChange(clampCrop(crop, effectiveRatio))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio])

  function clampCrop(c: CropState, ratioToEnforce: number | null): CropState {
    return clampRect(c, { width: imgSize.w, height: imgSize.h }, { minWidth: MIN_CROP_SIZE, minHeight: MIN_CROP_SIZE, ratio: ratioToEnforce })
  }

  // Start drag (mouse or touch)
  const startDrag = useCallback(
    (clientX: number, clientY: number, type: DragType) => {
      if (!crop) return
      setDragType(type)
      dragStartRef.current = { x: clientX, y: clientY, crop: { ...crop } }
    },
    [crop],
  )

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, type: DragType) => {
      e.preventDefault()
      e.stopPropagation()
      const pt = "touches" in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }
      startDrag(pt.x, pt.y, type)
    },
    [startDrag],
  )

  // Global move/end listeners (mouse + touch)
  useEffect(() => {
    if (!dragType || !dragStartRef.current || !crop) return

    const isCorner = isCornerHandle(dragType)
    const isEdge = isEdgeHandle(dragType)
    const cornerRatio = isCorner ? dragStartRef.current.crop.width / dragStartRef.current.crop.height : null

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      const { x: clientX, y: clientY } = eventClientXY(e)
      const start = dragStartRef.current!
      const newCrop = dragRect(start.crop, dragType, clientX - start.x, clientY - start.y)

      onCropChange(clampCrop(newCrop, isCorner ? cornerRatio : null))

      if (isEdge && onAspectRatioChange && aspectRatio !== "custom") {
        onAspectRatioChange("custom")
      }
    }

    const handleEnd = () => {
      setDragType(null)
      dragStartRef.current = null
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleEnd)
    window.addEventListener("touchmove", handleMove, { passive: false })
    window.addEventListener("touchend", handleEnd)
    window.addEventListener("touchcancel", handleEnd)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleEnd)
      window.removeEventListener("touchmove", handleMove)
      window.removeEventListener("touchend", handleEnd)
      window.removeEventListener("touchcancel", handleEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragType, crop])

  return (
    <div className="flex flex-col gap-3 items-center">
      <div
        ref={wrapperRef}
        className="relative select-none rounded-lg overflow-hidden bg-black touch-none inline-block max-w-full"
      >
        {mediaType === "image" ? (
          <img
            ref={(el) => attachObserver(el)}
            src={mediaUrl}
            alt={t("common.preview")}
            draggable={false}
            className="block w-full mx-auto"
            style={{ maxHeight: "55vh" }}
          />
        ) : (
          <video
            ref={(el) => { if (videoRef && "current" in videoRef) (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el; attachObserver(el) }}
            src={mediaUrl}
            muted
            playsInline
            className="block w-full mx-auto"
            style={{ maxHeight: "55vh" }}
          />
        )}

        {crop && imgSize.w > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
            <div className="absolute bg-black/60" style={{ top: crop.y + crop.height, left: 0, right: 0, bottom: 0 }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: 0, width: crop.x, height: crop.height }} />
            <div className="absolute bg-black/60" style={{ top: crop.y, left: crop.x + crop.width, right: 0, height: crop.height }} />

            <div
              className="absolute border-2 border-white/80 pointer-events-auto touch-none"
              style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height, cursor: "move" }}
              onMouseDown={(e) => handlePointerDown(e, "move")}
              onTouchStart={(e) => handlePointerDown(e, "move")}
            >
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/20" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/20" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/20" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/20" />
              </div>
              {RECT_HANDLES.map(({ type, style, cursor }) => (
                <div
                  key={type}
                  className="absolute w-4 h-4 bg-white border-2 border-[#ff0073] rounded-full z-10 pointer-events-auto touch-none"
                  style={{ ...style, cursor }}
                  onMouseDown={(e) => handlePointerDown(e, type)}
                  onTouchStart={(e) => handlePointerDown(e, type)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

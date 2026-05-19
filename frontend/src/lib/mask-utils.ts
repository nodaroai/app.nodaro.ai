export interface MaskStroke {
  points: Array<{ x: number; y: number }>
  radius: number
  isEraser: boolean // true = paint black (preserve), false = paint white (edit area)
  fill?: boolean    // true = fill entire canvas (used for invert)
  isLasso?: boolean // true = fill polygon defined by points[]
  opacity?: number  // 0–1 brush alpha, default 1
}

/**
 * Paint a single stroke onto a 2D canvas context. `fillStyle`,
 * `globalCompositeOperation`, and any pre-existing `globalAlpha` should
 * already be set by the caller. `scaleX`/`scaleY` divide source-pixel
 * coordinates down to a smaller display canvas (default 1 = source-pixel).
 */
export function paintStrokeOnCtx(
  ctx: CanvasRenderingContext2D,
  stroke: MaskStroke,
  scaleX = 1,
  scaleY = 1,
): void {
  ctx.globalAlpha = stroke.opacity ?? 1

  if (stroke.fill && !stroke.isLasso) {
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.globalAlpha = 1
    return
  }

  if (stroke.isLasso) {
    if (stroke.points.length < 3) { ctx.globalAlpha = 1; return }
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x / scaleX, stroke.points[0].y / scaleY)
    for (const pt of stroke.points.slice(1)) ctx.lineTo(pt.x / scaleX, pt.y / scaleY)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
    return
  }

  ctx.beginPath()
  for (const pt of stroke.points) {
    const cx = pt.x / scaleX
    const cy = pt.y / scaleY
    const r = stroke.radius / scaleX
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.globalAlpha = 1
}

/** Generate a black/white mask PNG blob from painted stroke data */
export function generateMaskBlob(
  width: number,
  height: number,
  strokes: MaskStroke[],
  baseImageData?: ImageData,
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!

  if (baseImageData) {
    ctx.putImageData(baseImageData, 0, 0)
  } else {
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, width, height)
  }

  for (const stroke of strokes) {
    ctx.fillStyle = stroke.isEraser ? "#000000" : "#ffffff"
    paintStrokeOnCtx(ctx, stroke)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create mask blob"))),
      "image/png",
    )
  })
}

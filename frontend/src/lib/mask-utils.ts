export interface MaskStroke {
  points: Array<{ x: number; y: number }>
  radius: number
  isEraser: boolean // true = paint black (preserve), false = paint white (edit area)
  fill?: boolean    // true = fill entire canvas (used for invert)
  isLasso?: boolean // true = fill polygon defined by points[]
  opacity?: number  // 0–1 brush alpha, default 1
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
    const alpha = stroke.opacity ?? 1
    ctx.globalAlpha = alpha
    ctx.fillStyle = stroke.isEraser ? "#000000" : "#ffffff"

    if (stroke.fill && !stroke.isLasso) {
      // invert: fill entire canvas
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
      continue
    }

    if (stroke.isLasso) {
      if (stroke.points.length < 3) { ctx.globalAlpha = 1; continue }
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (const pt of stroke.points.slice(1)) ctx.lineTo(pt.x, pt.y)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
      continue
    }

    // brush: paint a circle at every point
    ctx.beginPath()
    for (const pt of stroke.points) {
      ctx.moveTo(pt.x + stroke.radius, pt.y)
      ctx.arc(pt.x, pt.y, stroke.radius, 0, Math.PI * 2)
    }
    ctx.fill()
    ctx.globalAlpha = 1
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create mask blob"))),
      "image/png",
    )
  })
}

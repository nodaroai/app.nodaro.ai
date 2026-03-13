export interface MaskStroke {
  points: Array<{ x: number; y: number }>
  radius: number
  isEraser: boolean // true = paint black (preserve), false = paint white (edit area)
  fill?: boolean    // true = fill entire canvas (used for invert)
}

/** Generate a black/white mask PNG blob from painted stroke data */
export function generateMaskBlob(
  width: number,
  height: number,
  strokes: MaskStroke[],
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!

  // Start all black (preserve everything)
  ctx.fillStyle = "#000000"
  ctx.fillRect(0, 0, width, height)

  // Draw non-eraser strokes as white (edit area)
  ctx.fillStyle = "#ffffff"
  for (const stroke of strokes) {
    if (stroke.isEraser) continue
    if (stroke.fill) {
      ctx.fillRect(0, 0, width, height)
      continue
    }
    ctx.beginPath()
    for (const pt of stroke.points) {
      ctx.moveTo(pt.x + stroke.radius, pt.y)
      ctx.arc(pt.x, pt.y, stroke.radius, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  // Draw eraser strokes as black (restore preserve)
  ctx.fillStyle = "#000000"
  for (const stroke of strokes) {
    if (!stroke.isEraser) continue
    if (stroke.fill) {
      ctx.fillRect(0, 0, width, height)
      continue
    }
    ctx.beginPath()
    for (const pt of stroke.points) {
      ctx.moveTo(pt.x + stroke.radius, pt.y)
      ctx.arc(pt.x, pt.y, stroke.radius, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create mask blob"))),
      "image/png",
    )
  })
}

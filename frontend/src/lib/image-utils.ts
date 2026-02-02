export interface BoundingBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Crop a rectangular region from an already-loaded image element.
 * Coordinates are in the image's natural (pixel) space.
 * No CORS needed since we use the existing img element.
 */
export function cropImageElementToBlob(
  img: HTMLImageElement,
  box: BoundingBox,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas")
    canvas.width = box.width
    canvas.height = box.height
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      reject(new Error("Failed to get canvas context"))
      return
    }
    ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Failed to create blob from canvas"))
      },
      "image/png",
    )
  })
}

/**
 * Crop a freeform polygon region from an already-loaded image element.
 * The polygon is defined by an array of points in natural pixel space.
 * Pixels outside the polygon are transparent.
 */
export function cropPolygonToBlob(
  img: HTMLImageElement,
  points: readonly Point[],
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (points.length < 3) {
      reject(new Error("Polygon needs at least 3 points"))
      return
    }

    // Calculate bounding box of the polygon
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    minX = Math.round(Math.max(0, minX))
    minY = Math.round(Math.max(0, minY))
    maxX = Math.round(Math.min(img.naturalWidth, maxX))
    maxY = Math.round(Math.min(img.naturalHeight, maxY))
    const w = maxX - minX
    const h = maxY - minY

    if (w < 1 || h < 1) {
      reject(new Error("Selection too small"))
      return
    }

    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      reject(new Error("Failed to get canvas context"))
      return
    }

    // Create clipping path from polygon (shifted to local coords)
    ctx.beginPath()
    ctx.moveTo(points[0].x - minX, points[0].y - minY)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x - minX, points[i].y - minY)
    }
    ctx.closePath()
    ctx.clip()

    // Draw the image region
    ctx.drawImage(img, minX, minY, w, h, 0, 0, w, h)

    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Failed to create blob from canvas"))
      },
      "image/png",
    )
  })
}

/**
 * Get the bounding box of a polygon.
 */
export function polygonBoundingBox(points: readonly Point[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
  }
}

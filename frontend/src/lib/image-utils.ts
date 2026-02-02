export interface BoundingBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Crop a region from an image and return it as a Blob.
 * Coordinates are in the image's natural (pixel) space.
 */
export function cropImageToBlob(
  imageUrl: string,
  box: BoundingBox,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
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
    }
    img.onerror = () => reject(new Error("Failed to load image for cropping"))
    img.src = imageUrl
  })
}

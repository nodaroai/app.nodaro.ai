// frontend/src/components/editor/media-editor/utils.ts

export type MediaCategory = "image" | "video" | "audio"

export interface CropState {
  x: number       // crop region X in display coords
  y: number       // crop region Y in display coords
  width: number   // crop region width in display coords
  height: number  // crop region height in display coords
  zoom: number    // zoom level (1 = fit, >1 = zoomed in)
  panX: number    // pan offset X in display coords
  panY: number    // pan offset Y in display coords
}

export interface TrimState {
  startTime: number
  endTime: number
}

export interface MediaEditorState {
  crop: CropState | null
  trim: TrimState | null
  aspectRatio: string  // "original" | "1:1" | "16:9" | etc.
  format: string | null
}

export function detectMediaType(file: File): MediaCategory {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  // Fallback based on extension
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext ?? "")) return "image"
  if (["mp4", "webm", "mov", "avi"].includes(ext ?? "")) return "video"
  if (["mp3", "wav", "m4a", "aac"].includes(ext ?? "")) return "audio"
  return "image" // default
}

export function isBrowserPlayable(file: File): boolean {
  const playable = ["video/mp4", "video/webm"]
  return playable.includes(file.type)
}

/**
 * Crop an image client-side using Canvas API.
 * Returns a Blob of the cropped region.
 */
export async function cropImageCanvas(
  imageUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
  displayWidth: number,
  displayHeight: number,
  outputFormat?: string,
): Promise<Blob> {
  const img = new Image()
  img.crossOrigin = "anonymous"
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = imageUrl
  })

  // Translate display coords to natural (original) coords
  const scaleX = naturalWidth / displayWidth
  const scaleY = naturalHeight / displayHeight
  const sx = Math.round(crop.x * scaleX)
  const sy = Math.round(crop.y * scaleY)
  const sw = Math.round(crop.width * scaleX)
  const sh = Math.round(crop.height * scaleY)

  const canvas = document.createElement("canvas")
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

  const mimeType =
    outputFormat === "png" ? "image/png" :
    outputFormat === "webp" ? "image/webp" :
    outputFormat === "jpeg" || outputFormat === "jpg" ? "image/jpeg" :
    "image/png"

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      mimeType,
      0.92,
    )
  })
}

/**
 * Convert aspect ratio string to numeric ratio or null for "original".
 */
export function parseAspectRatio(ratio: string): number | null {
  if (ratio === "original") return null
  const [w, h] = ratio.split(":").map(Number)
  if (!w || !h) return null
  return w / h
}

export const DEFAULT_EDITOR_STATE: MediaEditorState = {
  crop: null,
  trim: null,
  aspectRatio: "original",
  format: null,
}

export const ASPECT_RATIO_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
]

export const IMAGE_FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
]

export const VIDEO_FORMAT_OPTIONS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
]

export const AUDIO_FORMAT_OPTIONS = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "m4a", label: "M4A" },
  { value: "aac", label: "AAC" },
]

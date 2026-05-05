import { isAudioUrl, isImageUrl, isVideoUrl } from "@/lib/media-type"

export type AssetKind = "video" | "image" | "audio" | "other"

export function classifyUrl(url: string): AssetKind {
  if (isVideoUrl(url)) return "video"
  if (isImageUrl(url)) return "image"
  if (isAudioUrl(url)) return "audio"
  return "other"
}

export function pathToLabel(segments: string[]): string {
  return segments.reduce((acc, segment) => {
    if (/^\d+$/.test(segment)) return `${acc}[${segment}]`
    return acc ? `${acc}.${segment}` : segment
  }, "")
}

export interface ExtractedAsset {
  readonly path: string
  readonly url: string
  readonly kind: AssetKind
}

export function extractAssets(value: unknown): ExtractedAsset[] {
  return walk(value, [])
}

function walk(value: unknown, path: string[]): ExtractedAsset[] {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return [{ path: pathToLabel(path), url: value, kind: classifyUrl(value) }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => walk(item, [...path, String(i)]))
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([k, v]) => walk(v, [...path, k]))
  }
  return []
}

export const TEXT_FIELDS = ["prompt", "generatedText", "text", "result", "error"] as const

export interface ExtractedText {
  readonly label: string
  readonly value: string
}

export function extractTextFields(data: Record<string, unknown>): ExtractedText[] {
  return TEXT_FIELDS
    .filter((field) => {
      const v = data[field]
      return typeof v === "string" && v.trim().length > 0
    })
    .map((field) => ({ label: field, value: data[field] as string }))
}

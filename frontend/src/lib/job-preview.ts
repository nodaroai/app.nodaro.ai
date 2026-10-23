/**
 * What a job made, for a small preview card: its video (with the image as the
 * poster), else its image, else its audio. Only http(s) addresses are offered,
 * since the card links to them.
 */
export type JobPreview =
  | { readonly kind: "video"; readonly url: string; readonly posterUrl?: string }
  | { readonly kind: "image"; readonly url: string }
  | { readonly kind: "audio"; readonly url: string }
  | { readonly kind: "none" }

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined
  return /^https?:\/\//i.test(value) ? value : undefined
}

export function jobPreview(job: { readonly output_data?: Record<string, unknown> | null }): JobPreview {
  const out = job.output_data ?? {}
  const imageList = Array.isArray(out.imageUrls) ? out.imageUrls : []
  const image = httpUrl(out.imageUrl) ?? httpUrl(imageList[0])
  const video = httpUrl(out.videoUrl)
  if (video) return image ? { kind: "video", url: video, posterUrl: image } : { kind: "video", url: video }
  if (image) return { kind: "image", url: image }
  const audio = httpUrl(out.audioUrl)
  if (audio) return { kind: "audio", url: audio }
  return { kind: "none" }
}

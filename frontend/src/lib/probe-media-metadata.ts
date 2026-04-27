/**
 * Probe natural dimensions and duration from a media Blob/File client-side.
 *
 * Used at result-creation time (uploads, edit saves, FreeCut saves, etc.) so
 * we can persist `width`/`height`/`duration` on the `GeneratedResult` without
 * waiting for the rendered <img>/<video>/<audio> onLoad to fire. Eliminates
 * the brief frame where a fresh result renders at stale node dimensions.
 *
 * Returns `undefined` for unsupported types or load failures — callers should
 * treat metadata as best-effort optional.
 */

export interface MediaMetadata {
  readonly width?: number
  readonly height?: number
  readonly duration?: number
}

const LOAD_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      () => { clearTimeout(timer); resolve(undefined) },
    )
  })
}

export async function probeMediaMetadata(blob: Blob | File): Promise<MediaMetadata | undefined> {
  const type = blob.type
  if (!type) return undefined

  const url = URL.createObjectURL(blob)
  try {
    if (type.startsWith("image/")) {
      const result = await withTimeout(
        new Promise<MediaMetadata | undefined>((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
          img.onerror = () => resolve(undefined)
          img.src = url
        }),
        LOAD_TIMEOUT_MS,
      )
      return result
    }

    if (type.startsWith("video/")) {
      const result = await withTimeout(
        new Promise<MediaMetadata | undefined>((resolve) => {
          const v = document.createElement("video")
          v.preload = "metadata"
          v.muted = true
          v.onloadedmetadata = () => resolve({
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
            duration: Number.isFinite(v.duration) ? v.duration : undefined,
          })
          v.onerror = () => resolve(undefined)
          v.src = url
        }),
        LOAD_TIMEOUT_MS,
      )
      return result
    }

    if (type.startsWith("audio/")) {
      const result = await withTimeout(
        new Promise<MediaMetadata | undefined>((resolve) => {
          const a = document.createElement("audio")
          a.preload = "metadata"
          a.onloadedmetadata = () => resolve({
            duration: Number.isFinite(a.duration) ? a.duration : undefined,
          })
          a.onerror = () => resolve(undefined)
          a.src = url
        }),
        LOAD_TIMEOUT_MS,
      )
      return result
    }

    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

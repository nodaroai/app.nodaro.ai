/**
 * Probe an audio URL for its duration using a hidden HTMLAudioElement.
 *
 * Resolves with the duration in seconds, or `undefined` if the browser can't
 * decode the metadata (CORS, unsupported format, network failure). Times out
 * after `timeoutMs` so a hung load never blocks the UI.
 *
 * Used by the lip-sync node to populate `audioDurationSec` so the backend
 * can reserve credits per-second for Kling AI Avatar 2.0 instead of charging
 * the worst-case 5-min bucket.
 */
const cache = new Map<string, number>()
const inflight = new Map<string, Promise<number | undefined>>()

export function probeAudioDuration(
  url: string,
  timeoutMs = 8000,
): Promise<number | undefined> {
  if (!url) return Promise.resolve(undefined)
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = inflight.get(url)
  if (existing) return existing

  const p = new Promise<number | undefined>((resolve) => {
    const audio = new Audio()
    audio.preload = "metadata"
    audio.crossOrigin = "anonymous"
    let settled = false
    const finish = (seconds: number | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeEventListener("loadedmetadata", onLoaded)
      audio.removeEventListener("error", onError)
      if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) {
        cache.set(url, seconds)
        resolve(seconds)
      } else {
        resolve(undefined)
      }
    }
    const onLoaded = () => finish(audio.duration)
    const onError = () => finish(undefined)
    audio.addEventListener("loadedmetadata", onLoaded)
    audio.addEventListener("error", onError)
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    audio.src = url
  }).finally(() => {
    inflight.delete(url)
  })
  inflight.set(url, p)
  return p
}

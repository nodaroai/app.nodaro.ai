// frontend/src/components/editor/media-editor/use-filmstrip.ts
import { useEffect, useState } from "react"

export interface FilmstripFrame {
  time: number
  dataUrl: string
}

export function useFilmstrip(videoUrl: string | null, frameCount = 10) {
  const [frames, setFrames] = useState<FilmstripFrame[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (!videoUrl) {
      setFrames([])
      setDuration(0)
      return
    }

    let cancelled = false
    setIsLoading(true)

    const video = document.createElement("video")
    video.crossOrigin = "anonymous"
    video.muted = true
    video.preload = "auto"

    const extractFrames = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve()
          video.onerror = () => reject(new Error("Failed to load video"))
          video.src = videoUrl
        })

        const dur = video.duration
        if (cancelled) return
        setDuration(dur)

        const canvas = document.createElement("canvas")
        const thumbHeight = 60
        const thumbWidth = Math.round((video.videoWidth / video.videoHeight) * thumbHeight)
        canvas.width = thumbWidth
        canvas.height = thumbHeight
        const ctx = canvas.getContext("2d")!

        const extracted: FilmstripFrame[] = []
        const interval = dur / frameCount

        for (let i = 0; i < frameCount; i++) {
          if (cancelled) return
          const time = i * interval

          await new Promise<void>((resolve) => {
            video.onseeked = () => {
              ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight)
              extracted.push({ time, dataUrl: canvas.toDataURL("image/jpeg", 0.6) })
              resolve()
            }
            video.currentTime = time
          })
        }

        if (!cancelled) {
          setFrames(extracted)
        }
      } catch {
        // Fail silently — filmstrip is best-effort
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    extractFrames()

    return () => {
      cancelled = true
      video.src = ""
    }
  }, [videoUrl, frameCount])

  return { frames, isLoading, duration }
}

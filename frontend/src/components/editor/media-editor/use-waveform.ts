// frontend/src/components/editor/media-editor/use-waveform.ts
import { useEffect, useState } from "react"

export function useWaveform(audioUrl: string | null, barCount = 80) {
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [duration, setDuration] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!audioUrl) {
      setWaveformData([])
      setDuration(0)
      return
    }

    let cancelled = false
    setIsLoading(true)

    const extract = async () => {
      try {
        const response = await fetch(audioUrl)
        const arrayBuffer = await response.arrayBuffer()
        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

        if (cancelled) {
          await audioCtx.close()
          return
        }

        setDuration(audioBuffer.duration)

        // Get first channel data
        const channelData = audioBuffer.getChannelData(0)
        const samplesPerBar = Math.floor(channelData.length / barCount)
        const bars: number[] = []

        for (let i = 0; i < barCount; i++) {
          const start = i * samplesPerBar
          const end = Math.min(start + samplesPerBar, channelData.length)
          let sum = 0
          for (let j = start; j < end; j++) {
            sum += Math.abs(channelData[j])
          }
          bars.push(sum / (end - start))
        }

        // Normalize to 0-1 range
        const max = Math.max(...bars, 0.001)
        const normalized = bars.map((b) => b / max)

        if (!cancelled) {
          setWaveformData(normalized)
        }

        await audioCtx.close()
      } catch {
        // Fail silently
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    extract()

    return () => {
      cancelled = true
    }
  }, [audioUrl, barCount])

  return { waveformData, duration, isLoading }
}

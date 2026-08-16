// frontend/src/components/heygen/use-voice-preview.ts
//
// Play / pause a voice's preview clip through the app-wide active-player
// singleton (one thing plays at a time — starting this preview pauses whatever
// else was playing, and vice versa). Shared by the voice picker rows and the
// on-node voice row so both behave identically.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  setActivePlayer,
  releaseActivePlayer,
  type ActivePlayerHandle,
} from "@/components/audio-player/active-player"

export interface VoicePreview {
  readonly isPlaying: boolean
  /** True when there is a clip to play. */
  readonly canPlay: boolean
  readonly toggle: () => void
}

export function useVoicePreview(previewUrl: string | null | undefined): VoicePreview {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // Stable handle for the active-player singleton. Created once per mount.
  const handleRef = useRef<ActivePlayerHandle | null>(null)
  if (!handleRef.current) {
    handleRef.current = {
      pause: () => {
        audioRef.current?.pause()
        setIsPlaying(false)
      },
    }
  }

  // Release the singleton slot on unmount so it doesn't hold a stale ref, and
  // stop the clip so an unmounted row can't keep talking.
  useEffect(() => {
    const handle = handleRef.current
    return () => {
      audioRef.current?.pause()
      if (handle) releaseActivePlayer(handle)
    }
  }, [])

  // A different clip → drop the old element so the next play loads the new one.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsPlaying(false)
  }, [previewUrl])

  const toggle = useCallback(() => {
    if (!previewUrl) return
    if (isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false)
      return
    }
    // Register with the singleton — pauses whatever was playing.
    setActivePlayer(handleRef.current!)
    if (!audioRef.current) {
      audioRef.current = new Audio(previewUrl)
      audioRef.current.onended = () => setIsPlaying(false)
      audioRef.current.onpause = () => setIsPlaying(false)
    }
    audioRef.current.play().catch(() => setIsPlaying(false))
    setIsPlaying(true)
  }, [isPlaying, previewUrl])

  return { isPlaying, canPlay: !!previewUrl, toggle }
}

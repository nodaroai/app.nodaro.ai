"use client"

// frontend/src/components/audio-player/waveform-audio-player.tsx
//
// The ONE audio player for the whole app. Every <audio> surface routes through
// this component. Behaviour (play / pause / stop / seek / time / download) and
// the wavesurfer lifecycle live here only; appearance comes entirely from the
// chosen `variant` preset (presets.ts). To change a look, edit a preset — never
// a call site. To give a place a different look (split stereo, no waveform),
// point it at a different variant.
//
// Robustness:
//  • wavesurfer is dynamic-imported (kept out of the initial bundle) and
//    lazy-mounted (decode only when scrolled into view).
//  • If wavesurfer fails to load/decode (bad codec, network), we fall back to a
//    native <audio controls> so audio is never unplayable.

import { Suspense, lazy, useCallback, useEffect, useState } from "react"
import type WaveSurfer from "wavesurfer.js"
import { cn } from "@/lib/utils"
import { AUDIO_PLAYER_PRESETS, AUDIO_PLAYER_THEME } from "./presets"
import { peakCache } from "./peak-cache"
import { useLazyMount } from "./use-lazy-mount"
import { AudioPlayerControls } from "./audio-player-controls"
import { AudioPlayerPlaceholder } from "./audio-player-placeholder"
import type { WaveformAudioPlayerProps } from "./types"

const WavesurferPlayer = lazy(() => import("@wavesurfer/react"))

export function WaveformAudioPlayer({
  url,
  variant = "compact",
  duration,
  peaks,
  autoPlay = false,
  label,
  download,
  isInsideCanvas = false,
  className,
}: WaveformAudioPlayerProps) {
  const preset = AUDIO_PLAYER_PRESETS[variant]
  const { ref, mounted, mountNow } = useLazyMount()
  const [wantsPlay, setWantsPlay] = useState(autoPlay)
  const [instance, setInstance] = useState<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalTime, setTotalTime] = useState(duration ?? 0)
  const [failed, setFailed] = useState(false)

  const isMounted = autoPlay || mounted
  const showDownload = download ?? preset.controls.download
  const cachedPeaks = peaks ?? peakCache.get(url)

  // Reset transport state whenever the source changes (e.g. switching result).
  useEffect(() => {
    setInstance(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setTotalTime(duration ?? 0)
    setFailed(false)
  }, [url, duration])

  const handlePlayPause = useCallback(() => {
    if (instance) {
      instance.playPause()
      return
    }
    // Not decoded yet — mount now and start playing once ready.
    setWantsPlay(true)
    mountNow()
  }, [instance, mountNow])

  const handleStop = useCallback(() => {
    instance?.stop() // wavesurfer: pause + seek to 0
    setIsPlaying(false)
    setCurrentTime(0)
  }, [instance])

  const handleDownload = useCallback(() => {
    const a = document.createElement("a")
    a.href = `/v1/image-proxy?url=${encodeURIComponent(url)}&download=1`
    a.download = `${label || "audio"}.mp3`
    a.click()
  }, [url, label])

  // Safety net: never leave audio unplayable.
  if (failed) {
    return (
      <audio
        src={url}
        crossOrigin="anonymous"
        controls
        autoPlay={autoPlay}
        className={cn("w-full h-8", className)}
        onClick={(e) => { if (isInsideCanvas) e.stopPropagation() }}
      />
    )
  }

  return (
    <div
      ref={ref}
      className={cn(
        "group/audioplayer flex w-full flex-col gap-2",
        isInsideCanvas && "nodrag nopan nowheel",
        className,
      )}
      // Bubbling (not capturing) so wavesurfer's own canvas handlers still fire;
      // this only stops the event from reaching React Flow's pane (no pan/drag).
      onPointerDown={isInsideCanvas ? (e) => e.stopPropagation() : undefined}
    >
      {preset.showWaveform && (
        <div style={{ height: preset.waveHeight }} className="w-full">
          {isMounted ? (
            <Suspense fallback={<AudioPlayerPlaceholder height={preset.waveHeight} bar={preset.bar} />}>
              <WavesurferPlayer
                url={url}
                height={preset.waveHeight}
                waveColor={AUDIO_PLAYER_THEME.waveColor}
                progressColor={AUDIO_PLAYER_THEME.progressColor}
                cursorColor={AUDIO_PLAYER_THEME.cursorColor}
                cursorWidth={2}
                barWidth={preset.bar.width}
                barGap={preset.bar.gap}
                barRadius={preset.bar.radius}
                normalize
                dragToSeek
                interact
                mediaControls={false}
                autoplay={wantsPlay}
                peaks={cachedPeaks}
                duration={duration}
                {...(preset.channels === "split" ? { splitChannels: [{}, {}] } : {})}
                onReady={(ws, dur) => { setInstance(ws); setTotalTime(dur) }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onFinish={() => setIsPlaying(false)}
                onTimeupdate={(_ws, t) => setCurrentTime(t)}
                onDecode={(ws) => { try { peakCache.set(url, ws.exportPeaks()) } catch { /* peaks unavailable */ } }}
                onError={() => setFailed(true)}
              />
            </Suspense>
          ) : (
            <AudioPlayerPlaceholder height={preset.waveHeight} bar={preset.bar} />
          )}
        </div>
      )}

      <AudioPlayerControls
        config={preset.controls}
        isPlaying={isPlaying}
        currentTime={currentTime}
        totalTime={totalTime}
        showDownload={showDownload}
        showProgressBar={!preset.showWaveform}
        progress={totalTime > 0 ? currentTime / totalTime : 0}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onDownload={handleDownload}
        onSeek={(fraction) => instance?.seekTo(fraction)}
      />
    </div>
  )
}

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
// Robustness — and why this is shaped the way it is:
//  • @wavesurfer/react rebuilds the wavesurfer instance whenever ANY option VALUE
//    it receives changes. So every option we pass MUST be stable across renders,
//    otherwise the instance is torn down + rebuilt mid-playback. We therefore:
//      - never pass `autoplay` (a torn-down autoplay leaves a detached, playing
//        media element — "ghost audio" you can't stop). We call play() on `ready`.
//      - never feed reactive `peaks` (undefined→array after decode = churn).
//      - memoise event handlers and `splitChannels` so they keep a stable identity.
//  • wavesurfer is dynamic-imported (out of the initial bundle) + lazy-mounted
//    (decode only when scrolled into view).
//  • On unmount we pause the instance (belt-and-suspenders over the wrapper's
//    destroy) so navigating away always stops audio.
//  • If wavesurfer fails to load/decode, we fall back to native <audio controls>.

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type WaveSurfer from "wavesurfer.js"
import { cn } from "@/lib/utils"
import { AUDIO_PLAYER_PRESETS, AUDIO_PLAYER_THEME } from "./presets"
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
  const [instance, setInstance] = useState<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalTime, setTotalTime] = useState(duration ?? 0)
  const [failed, setFailed] = useState(false)

  // Whether playback should start as soon as the instance is ready. A ref (not
  // state) so toggling it never re-renders and never churns wavesurfer options.
  const wantsPlayRef = useRef(autoPlay)
  // Latest instance, for unmount cleanup without making the effect depend on it.
  const instanceRef = useRef<WaveSurfer | null>(null)

  const isMounted = autoPlay || mounted
  const showDownload = download ?? preset.controls.download
  // Stable identity: only present when a split look is active; undefined otherwise.
  const splitChannels = useMemo(
    () => (preset.channels === "split" ? [{}, {}] : undefined),
    [preset.channels],
  )

  // Reset transport when the source changes (e.g. switching result / next item).
  useEffect(() => {
    setInstance(null)
    instanceRef.current = null
    setIsPlaying(false)
    setCurrentTime(0)
    setTotalTime(duration ?? 0)
    setFailed(false)
    wantsPlayRef.current = autoPlay
  }, [url, duration, autoPlay])

  // Always stop audio when the player leaves the tree.
  useEffect(() => () => { try { instanceRef.current?.pause() } catch { /* destroyed */ } }, [])

  // --- Stable event handlers (memoised so the wrapper doesn't rebind each render).
  const handleWsReady = useCallback((ws: WaveSurfer, dur: number) => {
    instanceRef.current = ws
    setInstance(ws)
    setTotalTime(dur)
    if (wantsPlayRef.current) ws.play().catch(() => { /* interrupted by unmount */ })
  }, [])
  const handleWsPlay = useCallback(() => setIsPlaying(true), [])
  const handleWsPause = useCallback(() => setIsPlaying(false), [])
  const handleWsFinish = useCallback(() => setIsPlaying(false), [])
  const handleWsTimeupdate = useCallback((_ws: WaveSurfer, t: number) => setCurrentTime(t), [])
  const handleWsError = useCallback(() => setFailed(true), [])

  // --- Transport.
  const handlePlayPause = useCallback(() => {
    if (instance) { instance.playPause(); return }
    // Not decoded yet — mount now and play once ready.
    wantsPlayRef.current = true
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
                peaks={peaks}
                duration={duration}
                splitChannels={splitChannels}
                onReady={handleWsReady}
                onPlay={handleWsPlay}
                onPause={handleWsPause}
                onFinish={handleWsFinish}
                onTimeupdate={handleWsTimeupdate}
                onError={handleWsError}
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

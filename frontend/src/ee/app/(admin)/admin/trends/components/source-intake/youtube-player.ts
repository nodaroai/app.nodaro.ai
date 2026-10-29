// A YouTube video in its embed, as a player the range strip can drive.
//
// The YouTube IFrame Player API is loaded once, and only when a YouTube link
// is fetched: it gives a real player (length, time, seek, play / pause), so the
// part to download is chosen on the video itself and only that part is
// downloaded. Private to the trend admin: the shared editor takes any player
// through its adapter interface and knows nothing of YouTube. Only the members
// called here are typed. It cannot run under jsdom; tests mock this module.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { PlayerAdapter } from "virtual:media-editor"

interface YTPlayer {
  getDuration(): number
  getCurrentTime(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  destroy(): void
}

interface YTPlayerEvent {
  readonly target: YTPlayer
  readonly data: number
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      host?: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?(event: YTPlayerEvent): void
        onStateChange?(event: YTPlayerEvent): void
        onError?(event: YTPlayerEvent): void
      }
    },
  ) => YTPlayer
}

type YTWindow = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api"

let apiPromise: Promise<YTNamespace> | null = null

/** `window.YT`, its script injected on the first call; concurrent callers share one load, and a failed load can be tried again. */
function loadYouTubeIframeApi(): Promise<YTNamespace> {
  const w = window as YTWindow
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    // Another integration's callback is kept: the API calls exactly one.
    const previous = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (w.YT?.Player) resolve(w.YT)
      else reject(new Error("no player"))
    }
    const tag = document.createElement("script")
    tag.src = IFRAME_API_SRC
    tag.async = true
    tag.onerror = () => {
      apiPromise = null
      reject(new Error("not loaded"))
    }
    document.head.appendChild(tag)
  })
  return apiPromise
}

export interface YouTubePlayer {
  readonly status: "loading" | "ready" | "error"
  readonly player: PlayerAdapter
}

/** How often the time is read off the player, in ms (the embed has no time event). */
const POLL_MS = 200
const STATE_PLAYING = 1
const STATE_BUFFERING = 3
/** A reading this close to a pending seek's target means it landed. */
const SEEK_SETTLE_SEC = 1
/** Readings after which a pending seek is given up and the player's time wins (2 s). */
const SEEK_SETTLE_TICKS = 10
/** An embed that has not answered by now will not (a blocked script or frame). */
const PLAYER_READY_TIMEOUT_MS = 15_000

/**
 * The video in a `youtube-nocookie` embed with no controls of its own (the
 * range strip is its transport), mirrored into a `PlayerAdapter`. The embed's
 * seek lands a tick or more later and the player answers the old time until
 * it does: those readings are ignored until it lands (or 2 s pass), so the
 * strip's loop never seeks over and over. `container` is replaced by the
 * iframe, so it must be an element React renders nothing into.
 */
export function useYouTubePlayer(videoId: string, container: RefObject<HTMLElement | null>): YouTubePlayer {
  const [status, setStatus] = useState<YouTubePlayer["status"]>("loading")
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const yt = useRef<YTPlayer | null>(null)
  const pendingSeek = useRef<{ target: number; ticks: number } | null>(null)
  const listeners = useRef(new Set<() => void>())

  useEffect(() => {
    for (const listener of listeners.current) listener()
  }, [status, duration, currentTime, playing])

  useEffect(() => {
    let cancelled = false
    let ready = false
    let poll: ReturnType<typeof setInterval> | undefined
    const fail = () => {
      if (cancelled) return
      if (poll) clearInterval(poll)
      setStatus("error")
    }
    const timeout = setTimeout(() => !ready && fail(), PLAYER_READY_TIMEOUT_MS)
    setStatus("loading")
    loadYouTubeIframeApi()
      .then((YT) => {
        const host = container.current
        if (cancelled || !host) return
        yt.current = new YT.Player(host, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1 },
          events: {
            onReady: (event) => {
              if (cancelled) return
              ready = true
              yt.current = event.target
              setDuration(event.target.getDuration() || 0)
              setStatus("ready")
              poll = setInterval(() => {
                const p = yt.current
                if (!p) return
                const t = p.getCurrentTime() || 0
                const pending = pendingSeek.current
                if (pending) {
                  pending.ticks += 1
                  if (Math.abs(t - pending.target) > SEEK_SETTLE_SEC && pending.ticks < SEEK_SETTLE_TICKS) return
                  pendingSeek.current = null
                }
                setCurrentTime(t)
                // Some videos settle their length a beat after ready.
                const d = p.getDuration()
                if (d > 0) setDuration((prev) => (prev === d ? prev : d))
              }, POLL_MS)
            },
            onStateChange: (event) => {
              if (!cancelled) setPlaying(event.data === STATE_PLAYING || event.data === STATE_BUFFERING)
            },
            // Embedding switched off by its owner, not found, any other: the embed cannot be used.
            onError: fail,
          },
        })
      })
      .catch(fail)
    return () => {
      cancelled = true
      clearTimeout(timeout)
      if (poll) clearInterval(poll)
      try {
        yt.current?.destroy()
      } catch {
        // Already torn down with its iframe.
      }
      yt.current = null
    }
  }, [videoId, container])

  const seek = useCallback((seconds: number) => {
    yt.current?.seekTo(seconds, true)
    pendingSeek.current = { target: seconds, ticks: 0 }
    setCurrentTime(seconds)
  }, [])
  const play = useCallback(() => yt.current?.playVideo(), [])
  const pause = useCallback(() => yt.current?.pauseVideo(), [])
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])

  // The adapter reads the latest values through a ref, so it stays one object for the player's life.
  const now = useRef({ duration, currentTime, playing })
  now.current = { duration, currentTime, playing }
  const player = useMemo<PlayerAdapter>(
    () => ({
      duration: () => now.current.duration,
      currentTime: () => now.current.currentTime,
      isPlaying: () => now.current.playing,
      seek,
      play,
      pause,
      subscribe,
    }),
    [seek, play, pause, subscribe],
  )
  return { status, player }
}

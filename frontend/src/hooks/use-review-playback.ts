/**
 * The review inspector's player (§2.3 of the inspectors design, A3-4): which
 * take or original plays, where, and the transcript's view of it.
 *
 * TABS. The take on display (labelled Preview or Final, R18 a), the newest
 * Preview beside a Final on display (`model.previewTake`), and Original. One
 * element plays at a time: choosing a tab pauses the others.
 *
 * A CLICK ON A KEPT WORD (`seekWord`) seeks the player. On a take with a clock
 * map (fresh, and not behind Camera Switch: `useReviewChecks`) it seeks to the
 * word's first kept instant on the take's own clock. Otherwise — the take is
 * stale (R3 a, decided 2026-10-06), there is none, it failed to load, or the
 * Original tab is open — it plays the ORIGINAL at that word (audition.ts). A
 * seek keeps playing if the player was playing.
 *
 * PLAY A SELECTION (`playRange`, decided 2026-10-07) follows the same rule: on
 * a take with a clock map it plays the selection's kept time through the
 * take's clock and stops at its last kept instant (a frame loop reads the
 * clock, as `timeupdate` is too coarse; a new take file drops the stop and any
 * held seek, which were on the old file's clock); otherwise (a stale take, the
 * Original tab, a selection with nothing kept) it is `hear`: the Original ±
 * 1.5 s.
 *
 * HEAR IT (`hear`) plays a span ± 1.5 s from the original file and stops at
 * the window's end (TA19 a, R6 a).
 *
 * SEEKS WAIT FOR METADATA. Originals are files of up to 8 GB opened with
 * `preload="metadata"`: a seek (and its play) is held per element until the
 * element has its metadata, then applied once. Showing another tab drops the
 * play of every other tab's held seek (a hidden element never starts), and
 * another render drops them all.
 *
 * REMOUNTS. An element remounts when its take's file changes, or when the
 * player does (the JSON view and back, the wide and narrow layouts). Play and
 * pause are read from the element, not from React state (an element removed
 * while playing reports no pause); the element on show starts paused; and an
 * element remounted on the same file comes back where the old one was.
 *
 * TIME. The element's time is kept outside React state (`subscribe` /
 * `timeMs` / `masterMs`), so a `timeupdate` re-renders only what reads it:
 * the transport, the minimap's playhead, and the transcript when the word
 * playing changes. `masterMs` is null until the reviewer first plays or seeks,
 * and while the take playing has no clock map.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react"
import type { Edl } from "@nodaro/shared"
import { auditionAt, auditionOfSpan, type Audition } from "@/lib/edl-review/audition"
import type { Interval } from "@/lib/edl-review/intervals"
import { masterOfPlayback } from "@/lib/edl-review/playhead"
import { previewSeekOfWord, previewSpanOfRange } from "@/lib/edl-review/review-clock"
import type { ReviewChecks } from "./use-review-checks"
import type { ReviewEdits } from "./use-review-edits"
import type { ReviewModel } from "./use-review-model"

export type PlayerTab = "take" | "preview" | "original"
export type MediaStatus = "idle" | "loading" | "ready" | "error"

const TABS: readonly PlayerTab[] = ["take", "preview", "original"]
const IDLE: Readonly<Record<PlayerTab, MediaStatus>> = { take: "idle", preview: "idle", original: "idle" }

/** The props a tab's media element takes. */
export interface MediaBinding {
  readonly ref: (el: HTMLMediaElement | null) => void
  readonly onLoadStart: () => void
  readonly onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => void
  readonly onCanPlay: () => void
  readonly onWaiting: () => void
  readonly onSeeking: () => void
  readonly onSeeked: (e: SyntheticEvent<HTMLMediaElement>) => void
  readonly onTimeUpdate: (e: SyntheticEvent<HTMLMediaElement>) => void
  readonly onPlay: () => void
  readonly onPause: () => void
  readonly onEnded: () => void
  readonly onError: () => void
}

export interface ReviewPlayback {
  readonly tab: PlayerTab
  /** The tabs offered, in order. */
  readonly tabs: readonly PlayerTab[]
  readonly audition: Audition | null
  readonly playing: boolean
  readonly status: Readonly<Record<PlayerTab, MediaStatus>>
  /** Follow playback: the transcript marks and scrolls to the word playing. */
  readonly follow: boolean
  readonly setFollow: (follow: boolean) => void
  readonly selectTab: (tab: PlayerTab) => void
  readonly seekWord: (word: number) => void
  readonly hear: (span: Interval) => void
  /** Play a selection (master clock): through the take when it has a clock, else `hear`. */
  readonly playRange: (range: Interval) => void
  readonly toggle: () => void
  /** Seek the active element on its own clock (the transport's scrubber). */
  readonly seek: (ms: number) => void
  readonly bind: (tab: PlayerTab) => MediaBinding
  readonly subscribe: (listener: () => void) => () => void
  /** The active element's time and length on its own clock, in ms. */
  readonly timeMs: () => number
  readonly durationMs: () => number
  /** The master instant playing; null before the first play or seek, or with no clock map. */
  readonly masterMs: () => number | null
}

interface PendingSeek {
  readonly ms: number
  readonly play: boolean
}

function playEl(el: HTMLMediaElement): void {
  try {
    const started = el.play() as Promise<void> | undefined
    if (started && typeof started.catch === "function") started.catch(() => undefined)
  } catch {
    // Not playable here (no media, or the browser refused): the element reports it.
  }
}

export function useReviewPlayback(model: ReviewModel, edits: ReviewEdits, checks: ReviewChecks): ReviewPlayback {
  const { base, render, take, previewTake, transcript, offsetMs, renderId } = model
  const [tab, setTab] = useState<PlayerTab>("take")
  const [audition, setAudition] = useState<Audition | null>(null)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState(IDLE)
  const [follow, setFollow] = useState(true)

  const els = useRef<Record<PlayerTab, HTMLMediaElement | null>>({ take: null, preview: null, original: null })
  const pending = useRef<Record<PlayerTab, PendingSeek | null>>({ take: null, preview: null, original: null })
  // Where an element was when it unmounted, and on which file.
  const gone = useRef<Record<PlayerTab, { readonly url: string | null; readonly ms: number } | null>>({ take: null, preview: null, original: null })
  // Where Play on a selection stops the take on show; any other seek or tab drops it.
  const stopAt = useRef<{ readonly tab: PlayerTab; readonly ms: number } | null>(null)
  const time = useRef({ ms: 0, durationMs: 0, engaged: false, stopped: false })
  const listeners = useRef(new Set<() => void>())
  const notify = useCallback(() => listeners.current.forEach((l) => l()), [])

  // What `masterMs` and the handlers read: the latest render's values.
  const live = useRef({ tab, audition, maps: { take: checks.clockMap, preview: checks.previewClockMap } as Record<"take" | "preview", Edl | null>, playing })
  live.current = { tab, audition, maps: { take: checks.clockMap, preview: checks.previewClockMap }, playing }
  useEffect(notify, [notify, tab, audition, checks.clockMap, checks.previewClockMap])

  // Another render, another review: start over.
  useEffect(() => {
    setTab("take")
    setAudition(null)
    setStatus(IDLE)
    setPlaying(false)
    pending.current = { take: null, preview: null, original: null }
    stopAt.current = null
    gone.current = { take: null, preview: null, original: null }
    time.current = { ms: 0, durationMs: 0, engaged: false, stopped: false }
  }, [renderId])
  // A new take is a new file: its old load state, and everything held on the
  // old file's clock — a seek waiting for metadata, the stop of a Play
  // selection, where the element last was — no longer applies.
  const dropFile = useCallback((t: "take" | "preview") => {
    pending.current[t] = null
    gone.current[t] = null
    if (stopAt.current?.tab === t) stopAt.current = null
    setStatus((s) => (s[t] === "idle" ? s : { ...s, [t]: "idle" }))
  }, [])
  useEffect(() => dropFile("take"), [dropFile, take?.url])
  useEffect(() => dropFile("preview"), [dropFile, previewTake?.url])

  const tabs = useMemo<readonly PlayerTab[]>(
    () => TABS.filter((t) => t === "take" || (t === "preview" && !!previewTake) || (t === "original" && !!base)),
    [previewTake, base],
  )

  const masterMs = useCallback((): number | null => {
    if (!time.current.engaged) return null
    const { tab: at, audition: a, maps } = live.current
    if (at === "original") return a ? masterOfPlayback({ kind: "original", sourceOffsetMs: a.sourceOffsetMs }, time.current.ms) : null
    return masterOfPlayback({ kind: "take", map: maps[at] }, time.current.ms)
  }, [])

  const setStatusOf = useCallback((t: PlayerTab, next: MediaStatus) => {
    setStatus((s) => (s[t] === next ? s : { ...s, [t]: next }))
  }, [])

  // Play on a selection stops at its last kept instant. `timeupdate` comes about
  // four times a second, so while a stop is set and the element plays, a frame
  // loop reads its clock; `timeupdate` stays as the fallback (a hidden page
  // gets no frames). It rearms on `play`, and ends on `pause` and at the stop.
  const frame = useRef<number | null>(null)
  const watchStop = useCallback(() => {
    if (frame.current !== null || typeof requestAnimationFrame !== "function") return
    const tick = () => {
      frame.current = null
      const stop = stopAt.current
      const el = stop ? els.current[stop.tab] : null
      if (!stop || !el || el.paused) return
      if (el.currentTime * 1000 >= stop.ms) {
        stopAt.current = null
        el.pause()
        if (live.current.tab === stop.tab) {
          time.current.ms = el.currentTime * 1000
          notify()
        }
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [notify])
  useEffect(
    () => () => {
      if (frame.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current)
      frame.current = null
    },
    [],
  )

  const pauseOthers = useCallback((keep: PlayerTab) => {
    stopAt.current = null
    for (const t of TABS) {
      if (t === keep) continue
      els.current[t]?.pause()
      const wait = pending.current[t]
      if (wait?.play) pending.current[t] = { ...wait, play: false }
    }
  }, [])

  /** Seek tab `t`'s element to `ms` (its own clock), once it has its metadata —
   *  of `url` when given: the original may be about to switch files. */
  const seekEl = useCallback((t: PlayerTab, ms: number, play: boolean, url?: string) => {
    time.current.engaged = true
    stopAt.current = null
    const el = els.current[t]
    if (!el || el.readyState < 1 || (url !== undefined && el.getAttribute("src") !== url)) {
      pending.current[t] = { ms, play }
      return
    }
    pending.current[t] = null
    el.currentTime = ms / 1000
    if (play) playEl(el)
  }, [])

  const show = useCallback((t: PlayerTab) => {
    pauseOthers(t)
    setTab(t)
  }, [pauseOthers])

  /** Play the original from `next` (a new audition, even when it equals the last). */
  const openOriginal = useCallback((next: Audition | null, play: boolean) => {
    if (!next) return
    show("original")
    time.current.stopped = false
    setAudition(next)
    seekEl("original", next.fromMs, play, next.url)
  }, [show, seekEl])

  const words = transcript?.words
  const seekWord = useCallback((word: number) => {
    const w = words?.[word]
    if (!w || !base) return
    const { tab: at, maps, playing: wasPlaying } = live.current
    if (at !== "original") {
      const map = maps[at]
      const has = at === "take" ? !!take : !!previewTake
      const out = map && has && status[at] !== "error" ? previewSeekOfWord(map, w, offsetMs) : null
      if (out !== null) {
        seekEl(at, out, wasPlaying)
        return
      }
    }
    openOriginal(auditionAt(base, render, w.startMs + offsetMs), wasPlaying)
  }, [words, base, take, previewTake, status, offsetMs, render, seekEl, openOriginal])

  const hear = useCallback((span: Interval) => {
    if (base) openOriginal(auditionOfSpan(base, render, span), true)
  }, [base, render, openOriginal])

  const playRange = useCallback((range: Interval) => {
    const { tab: at, maps } = live.current
    if (at !== "original") {
      const has = at === "take" ? !!take : !!previewTake
      const span = has && status[at] !== "error" ? previewSpanOfRange(maps[at], range) : null
      if (span) {
        seekEl(at, span.inMs, true)
        stopAt.current = { tab: at, ms: span.outMs }
        watchStop()
        return
      }
    }
    hear(range)
  }, [take, previewTake, status, seekEl, hear, watchStop])

  const selectTab = useCallback((t: PlayerTab) => {
    if (t !== "original" || live.current.audition) {
      show(t)
      return
    }
    if (!base) return
    // The Original, first opened: where the take is, else the cut's first kept instant.
    const start = masterMs() ?? edits.edited?.segments[0]?.inMs ?? base.segments[0]?.inMs ?? 0
    openOriginal(auditionAt(base, render, start), false)
  }, [show, base, render, edits.edited, openOriginal, masterMs])

  const toggle = useCallback(() => {
    const el = els.current[live.current.tab]
    if (!el) return
    if (!el.paused) el.pause()
    else {
      time.current.engaged = true
      playEl(el)
    }
  }, [])

  const seek = useCallback((ms: number) => seekEl(live.current.tab, ms, false), [seekEl])

  const bindings = useMemo(() => {
    const make = (t: PlayerTab): MediaBinding => {
      const report = (el: HTMLMediaElement) => {
        if (live.current.tab !== t) return
        time.current.ms = el.currentTime * 1000
        time.current.durationMs = Number.isFinite(el.duration) ? el.duration * 1000 : 0
        notify()
      }
      return {
        ref: (el) => {
          const old = els.current[t]
          els.current[t] = el
          if (!el) {
            if (old) gone.current[t] = { url: old.getAttribute("src"), ms: old.currentTime * 1000 }
            if (live.current.tab === t) setPlaying(false)
            return
          }
          const was = gone.current[t]
          gone.current[t] = null
          if (was && was.ms > 0 && was.url === el.getAttribute("src") && !pending.current[t]) pending.current[t] = { ms: was.ms, play: false }
          if (live.current.tab === t) setPlaying(!el.paused)
        },
        onLoadStart: () => setStatusOf(t, "loading"),
        onLoadedMetadata: (e) => {
          const el = e.currentTarget
          const wait = pending.current[t]
          pending.current[t] = null
          if (wait) {
            el.currentTime = wait.ms / 1000
            if (wait.play) playEl(el)
          }
          setStatusOf(t, "ready")
          report(el)
        },
        onCanPlay: () => setStatusOf(t, "ready"),
        onWaiting: () => setStatusOf(t, "loading"),
        onSeeking: () => {
          if (t === "original") setStatusOf(t, "loading")
        },
        onSeeked: (e) => {
          setStatusOf(t, "ready")
          report(e.currentTarget)
        },
        onTimeUpdate: (e) => {
          const el = e.currentTarget
          const a = live.current.audition
          // An audition stops at its window's end, once (play on from there plays on).
          if (t === "original" && a?.toMs != null && !time.current.stopped && el.currentTime * 1000 >= a.toMs) {
            time.current.stopped = true
            el.pause()
          }
          const stop = stopAt.current
          if (t !== "original" && stop?.tab === t && el.currentTime * 1000 >= stop.ms) {
            stopAt.current = null
            el.pause()
          }
          report(el)
        },
        onPlay: () => {
          if (live.current.tab === t) setPlaying(true)
          if (stopAt.current?.tab === t) watchStop()
        },
        onPause: () => {
          if (live.current.tab === t) setPlaying(false)
        },
        onEnded: () => {
          if (live.current.tab === t) setPlaying(false)
        },
        onError: () => {
          setStatusOf(t, "error")
          if (live.current.tab === t) setPlaying(false)
        },
      }
    }
    return { take: make("take"), preview: make("preview"), original: make("original") }
  }, [notify, setStatusOf, watchStop])
  const bind = useCallback((t: PlayerTab) => bindings[t], [bindings])

  // The element on show changed: report its time, and it is not playing yet.
  useEffect(() => {
    const el = els.current[tab]
    time.current.ms = el ? el.currentTime * 1000 : 0
    time.current.durationMs = el && Number.isFinite(el.duration) ? el.duration * 1000 : 0
    setPlaying(el ? !el.paused && !el.ended && el.readyState > 2 : false)
    notify()
  }, [tab, notify])

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])
  const timeMs = useCallback(() => time.current.ms, [])
  const durationMs = useCallback(() => time.current.durationMs, [])

  return useMemo(
    () => ({ tab, tabs, audition, playing, status, follow, setFollow, selectTab, seekWord, hear, playRange, toggle, seek, bind, subscribe, timeMs, durationMs, masterMs }),
    [tab, tabs, audition, playing, status, follow, selectTab, seekWord, hear, playRange, toggle, seek, bind, subscribe, timeMs, durationMs, masterMs],
  )
}

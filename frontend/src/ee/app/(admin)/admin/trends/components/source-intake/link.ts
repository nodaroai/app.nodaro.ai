// A source clip from a link (YouTube, TikTok, Instagram, X, Facebook):
// downloaded into the admin's own media through the platform's link download
// (`downloadVideoLink`), a YouTube video only in the part picked on its embed.
// Every failure is worded here from its class; the download's own text (the
// downloader's or the platform's) is never shown.

import { useCallback, useEffect, useRef, useState } from "react"
import { detectVideoLinkPlatform } from "@nodaro/shared/video"
import { discardMedia, fetchVideoMetadata } from "@/lib/api"
import { extractVideoLinkId, type DownloadErrorCode } from "@/lib/video-link"
import { downloadVideoLink } from "@/lib/video-link-download"

/** Why a link gave no clip. */
export type LinkFailure = DownloadErrorCode | "unsupported" | "noVideo"

export const LINK_FAILURES: Readonly<Record<LinkFailure, string>> = {
  unsupported: "Paste a YouTube, TikTok, Instagram, X or Facebook link.",
  noVideo: "This link does not point at one video. Paste the video's own link.",
  live: "This is a live stream. Use a recorded video.",
  busy: "Too many downloads are running on this account. Wait for one to finish, then try again.",
  private: "This video is private or needs a sign-in. Use a public video.",
  age_restricted: "This video is age-restricted and cannot be downloaded. Use another video.",
  region: "This video is not available where it is downloaded from. Use another video.",
  no_audio: "The download came without its sound. Try again, or use another video.",
  connection: "The connection to the download was lost. Try again.",
  generic: "The video could not be downloaded. Check the link and try again.",
}

/** Failures another try of the same link may fix. */
export const RETRYABLE: ReadonlySet<LinkFailure> = new Set<LinkFailure>(["busy", "no_audio", "connection", "generic"])

/** The longest video downloaded whole when its embed cannot play (the platform's embed-free cap, 10 min). */
export const WHOLE_DOWNLOAD_MAX_SEC = 600

/** A part of the video, in seconds. */
export interface LinkSection {
  readonly startSec: number
  readonly endSec: number
}

export type LinkState =
  | { readonly step: "idle" }
  /** A YouTube link's length and live state being read. */
  | { readonly step: "probing"; readonly url: string }
  /** A YouTube video waiting for the part to download (its length when the platform could read it). */
  | { readonly step: "range"; readonly url: string; readonly youtubeId: string; readonly durationSec: number | null; readonly title: string | null }
  | { readonly step: "downloading"; readonly url: string; readonly percent: number }
  | { readonly step: "failed"; readonly url: string; readonly failure: LinkFailure; readonly section?: LinkSection }

/** A finished download: the file in the admin's media, and what to call it. */
export interface LinkClip {
  readonly videoUrl: string
  readonly label: string
}

const SITE_NAMES: Readonly<Record<string, string>> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "X",
  facebook: "Facebook",
}

/** True when the text is a link this intake fetches (by exact host). */
export function isVideoLink(text: string): boolean {
  return detectVideoLinkPlatform(text.trim()) !== "unknown"
}

export interface SourceLink {
  readonly state: LinkState
  /** Takes a pasted link: refused at once when it is not one; a YouTube video waits for its part; any other downloads whole. */
  readonly fetch: (text: string) => void
  /** Downloads the YouTube video's `section` (cut exactly), or the whole video with none; also Try again after a failure. */
  readonly download: (section?: LinkSection) => void
  /** Back to the field. A download still running is let go: its file is thrown away when it lands. */
  readonly reset: () => void
}

const NEVER = new AbortController().signal

/**
 * The link's steps, in memory only. Every fetch is a generation: a later
 * fetch, `reset` or unmount makes the earlier one stale. A stale download is
 * not stopped (the platform finishes it anyway); it is followed to its end so
 * its file is discarded, never shown and never left in the admin's media.
 */
export function useSourceLink(onClip: (clip: LinkClip) => void): SourceLink {
  const [state, setState] = useState<LinkState>({ step: "idle" })
  const generation = useRef(0)
  const current = useRef<LinkState>(state)
  const deliver = useRef(onClip)
  useEffect(() => {
    current.current = state
    deliver.current = onClip
  })
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )

  const start = useCallback(async (url: string, title: string | null, section: LinkSection | undefined, gen: number) => {
    const live = () => generation.current === gen
    setState({ step: "downloading", url, percent: 0 })
    const outcome = await downloadVideoLink(url, section ? { mode: "section", section } : { mode: "whole" }, {
      onEvent: (event) => {
        if (live() && event.kind === "progress") {
          setState({ step: "downloading", url, percent: Math.max(0, Math.min(100, Math.round(event.percent))) })
        }
      },
      signal: NEVER,
    })
    if (outcome.status === "completed") {
      if (!live()) {
        void discardMedia(outcome.videoUrl)
        return
      }
      const site = SITE_NAMES[detectVideoLinkPlatform(url)]
      setState({ step: "idle" })
      deliver.current({ videoUrl: outcome.videoUrl, label: title?.trim() || (site ? `From ${site}` : url) })
      return
    }
    if (!live()) return
    const failure: LinkFailure = outcome.status === "failed" ? outcome.code : "generic"
    setState({ step: "failed", url, failure, ...(section ? { section } : {}) })
  }, [])

  const fetch = useCallback(
    (text: string) => {
      const url = text.trim()
      const gen = ++generation.current
      if (!isVideoLink(url)) {
        setState({ step: "failed", url, failure: "unsupported" })
        return
      }
      if (detectVideoLinkPlatform(url) !== "youtube") {
        void start(url, null, undefined, gen)
        return
      }
      const youtubeId = extractVideoLinkId(url)
      if (youtubeId === null) {
        setState({ step: "failed", url, failure: "noVideo" })
        return
      }
      setState({ step: "probing", url })
      void fetchVideoMetadata(url).then((meta) => {
        if (generation.current !== gen) return
        if (meta.isLive) setState({ step: "failed", url, failure: "live" })
        else {
          const durationSec = meta.durationSec !== null && meta.durationSec > 0 ? meta.durationSec : null
          setState({ step: "range", url, youtubeId, durationSec, title: meta.title })
        }
      })
    },
    [start],
  )

  const download = useCallback(
    (section?: LinkSection) => {
      const now = current.current
      if (now.step !== "range" && now.step !== "failed") return
      const gen = ++generation.current
      const title = now.step === "range" ? now.title : null
      void start(now.url, title, section ?? (now.step === "failed" ? now.section : undefined), gen)
    },
    [start],
  )

  const reset = useCallback(() => {
    generation.current += 1
    setState({ step: "idle" })
  }, [])

  return { state, fetch, download, reset }
}

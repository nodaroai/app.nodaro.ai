// A source clip from a link (YouTube, TikTok, Instagram, X, Facebook):
// downloaded into the admin's own media through the platform's link download
// (`downloadVideoLink`), a YouTube video only in the part picked on its embed.
// An import of a link: the admin confirms the content rights declaration
// first (the box starts unticked and a changed link unticks it), the
// confirmation is recorded for the link and rides into the download. Every
// failure is worded here from its class; the download's own text (the
// downloader's or the platform's) is never shown.

import { useCallback, useEffect, useRef, useState } from "react"
import { detectVideoLinkPlatform } from "@nodaro/shared/video"
import type { ContentRightsDeclaration } from "@nodaro/sdk/content-rights"
import { discardMedia, fetchVideoMetadata } from "@/lib/api"
import { nodaroClient } from "@/lib/nodaro-client"
import { extractVideoLinkId, type DownloadErrorCode } from "@/lib/video-link"
import { downloadVideoLink } from "@/lib/video-link-download"

/** Why a link gave no clip. */
export type LinkFailure = DownloadErrorCode | "unsupported" | "noVideo" | "rights"

export const LINK_FAILURES: Readonly<Record<LinkFailure, string>> = {
  unsupported: "Paste a link to where the video is.",
  noVideo: "This link does not point at one video. Paste the video's own link.",
  rights: "The confirmation for this link didn't go through. Read the declaration and tick the box again.",
  refused: "This link can't be imported here.",
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
export const RETRYABLE: ReadonlySet<LinkFailure> = new Set<LinkFailure>(["rights", "busy", "no_audio", "connection", "generic"])

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

/** The declaration as the page has it: loading, its text, or why it could not be read. */
export type DeclarationState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly declaration: ContentRightsDeclaration }
  | { readonly status: "failed"; readonly message: string }

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
  /** The declaration the admin confirms before a link is fetched. */
  readonly declaration: DeclarationState
  /** Reads the declaration again after a failed read. */
  readonly reloadDeclaration: () => void
  /** The box: ticked for the link about to be fetched; a changed link unticks it. */
  readonly confirmed: boolean
  readonly setConfirmed: (confirmed: boolean) => void
  /** Takes a pasted link: refused at once when it is not one, or when the declaration is not confirmed; a YouTube video waits for its part; any other downloads whole. */
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
  const [declaration, setDeclaration] = useState<DeclarationState>({ status: "loading" })
  const [confirmed, setConfirmed] = useState(false)
  const generation = useRef(0)
  const current = useRef<LinkState>(state)
  const declared = useRef<DeclarationState>(declaration)
  const deliver = useRef(onClip)
  useEffect(() => {
    current.current = state
    declared.current = declaration
    deliver.current = onClip
  })
  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )

  const reloadDeclaration = useCallback(() => {
    setDeclaration({ status: "loading" })
    nodaroClient.contentRights.declaration().then(
      (read) => setDeclaration({ status: "ready", declaration: read }),
      // Worded here, never in the platform's words.
      () => setDeclaration({ status: "failed", message: "The declaration could not be loaded." }),
    )
  }, [])
  useEffect(() => {
    reloadDeclaration()
  }, [reloadDeclaration])

  const start = useCallback(async (url: string, title: string | null, section: LinkSection | undefined, gen: number) => {
    const live = () => generation.current === gen
    setState({ step: "downloading", url, percent: 0 })
    // The confirmation for THIS link, under the declaration shown, recorded
    // before anything is fetched; the download is made under it.
    const read = declared.current
    const confirm = async (): Promise<string> => {
      if (read.status !== "ready") throw new Error("The declaration is not loaded")
      return (await nodaroClient.contentRights.confirm({ url, declarationVersion: read.declaration.version })).id
    }
    let confirmationId: string
    try {
      confirmationId = await confirm()
    } catch {
      // The declaration may have changed since it was read (the server refuses
      // a confirmation under an older version): read it again, untick, and
      // let the admin confirm the text as it is now.
      reloadDeclaration()
      setConfirmed(false)
      if (live()) setState({ step: "failed", url, failure: "rights", ...(section ? { section } : {}) })
      return
    }
    if (!live()) return
    const outcome = await downloadVideoLink(url, section ? { mode: "section", section, confirmationId } : { mode: "whole", confirmationId }, {
      onEvent: (event) => {
        if (live() && event.kind === "progress") {
          setState({ step: "downloading", url, percent: Math.max(0, Math.min(100, Math.round(event.percent))) })
        }
      },
      signal: NEVER,
      // The one restart after the server forgot the download: the first confirmation was spent by the first start.
      refreshConfirmation: confirm,
    })
    if (outcome.status === "completed") {
      if (!live()) {
        void discardMedia(outcome.videoUrl)
        return
      }
      const site = SITE_NAMES[detectVideoLinkPlatform(url)]
      setState({ step: "idle" })
      setConfirmed(false)
      deliver.current({ videoUrl: outcome.videoUrl, label: title?.trim() || (site ? `From ${site}` : url) })
      return
    }
    if (!live()) return
    const failure: LinkFailure = outcome.status === "failed" ? outcome.code : "generic"
    setState({ step: "failed", url, failure, ...(section ? { section } : {}) })
  }, [reloadDeclaration])

  const fetch = useCallback(
    (text: string) => {
      const url = text.trim()
      // A link this intake does not take is said at once, confirmed or not.
      if (!isVideoLink(url)) {
        generation.current += 1
        setState({ step: "failed", url, failure: "unsupported" })
        return
      }
      // Not confirmed: nothing starts, and nothing in flight is made stale.
      if (!confirmed) return
      const gen = ++generation.current
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
    [confirmed, start],
  )

  const download = useCallback(
    (section?: LinkSection) => {
      const now = current.current
      if (now.step !== "range" && now.step !== "failed") return
      // The box can be unticked after a failure: no download without it.
      if (!confirmed) return
      const gen = ++generation.current
      const title = now.step === "range" ? now.title : null
      void start(now.url, title, section ?? (now.step === "failed" ? now.section : undefined), gen)
    },
    [confirmed, start],
  )

  const reset = useCallback(() => {
    generation.current += 1
    setState({ step: "idle" })
  }, [])

  return { state, declaration, reloadDeclaration, confirmed, setConfirmed, fetch, download, reset }
}

// Getting a new source clip in, with the shared media editor: Upload, a library
// video's address, or a link (YouTube, TikTok, Instagram, X, Facebook). Every
// clip then shows its range and shape (ClipEditStep) before it is stored.
//
// "Use this clip": when the admin changed anything, the platform cuts it first
// (`processMedia`, free; no longer than 29.9 s, as its re-encode runs a few ms
// long), then the cut's address — or the clip's own, unchanged — goes to the
// trend's store (`store`, which copies it into the trend's storage). Only once
// the store has answered are this intake's own files thrown away: the cut, and
// a link's download (`discardMedia`, best effort). An upload or a library
// video is never thrown away. A failed store keeps both, for another try.

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { MediaEditorParts } from "virtual:media-editor"
import { discardMedia, processMedia } from "@/lib/api"
import { MediaPicker } from "../MediaPicker"
import { uploadLocalFile } from "../uploads"
import { ClipEditStep, type EditChoice, type IntakeWork } from "./ClipEditStep"
import { cutRequest } from "./edit"
import { isVideoLink, useSourceLink, type LinkClip } from "./link"
import { LinkSource } from "./LinkSource"

/** A clip waiting for its range and shape: `link` when this intake downloaded it (its file is the intake's own). */
interface Candidate {
  readonly url: string
  readonly label: string
  readonly origin: "own" | "link"
}

/** A cut already made, kept for another try of a store that failed. */
interface Cut {
  readonly key: string
  readonly url: string
}

interface Props {
  readonly parts: MediaEditorParts
  readonly hasSource: boolean
  /** The trend's media store is busy (another clip being stored). */
  readonly busy: boolean
  /** Stores the address as the trend's source; true once it is the trend's. */
  readonly store: (url: string) => Promise<boolean>
}

export function SourceIntake({ parts, hasSource, busy, store }: Props) {
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [uploading, setUploading] = useState(false)
  const [work, setWork] = useState<IntakeWork>(null)
  const cut = useRef<Cut | null>(null)
  const open = useRef<Candidate | null>(null)
  const mounted = useRef(true)

  const take = useCallback((next: Candidate) => {
    open.current = next
    setCandidate(next)
  }, [])
  const link = useSourceLink(useCallback((clip: LinkClip) => take({ url: clip.videoUrl, label: clip.label, origin: "link" }), [take]))

  /** Throws away the intake's own files for the clip that was open: its cut, and its download. */
  const discardOwn = useCallback((was: Candidate | null) => {
    if (cut.current) void discardMedia(cut.current.url)
    cut.current = null
    if (was?.origin === "link") void discardMedia(was.url)
  }, [])

  // Leaving the page with a clip still open: its cut and download go.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discardOwn(open.current)
    }
  }, [discardOwn])

  const close = () => {
    open.current = null
    setCandidate(null)
  }

  const cancel = () => {
    discardOwn(candidate)
    close()
  }

  const fromFile = async (file: File) => {
    setUploading(true)
    try {
      take({ url: await uploadLocalFile(file), label: file.name, origin: "own" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const fromUrl = (url: string) => {
    // A video site's link pasted in the address field is fetched as a link.
    if (isVideoLink(url)) link.fetch(url)
    else take({ url, label: url, origin: "own" })
  }

  const confirm = async (choice: EditChoice) => {
    const clip = candidate
    if (!clip || work) return
    const request = choice ? cutRequest(clip.url, choice.edit, choice.sec) : null
    let url = clip.url
    if (request) {
      const key = JSON.stringify(request)
      if (cut.current?.key === key) url = cut.current.url
      else {
        if (cut.current) void discardMedia(cut.current.url)
        cut.current = null
        setWork("cutting")
        try {
          const made = await processMedia(request)
          // The page was left while cutting: the cut is not stored, it goes.
          if (!mounted.current) {
            void discardMedia(made.url)
            return
          }
          cut.current = { key, url: made.url }
          url = made.url
        } catch {
          setWork(null)
          toast.error("The clip could not be cut. Try again.")
          return
        }
      }
    }
    setWork("storing")
    // While the store copies the file nothing else may discard it (leaving the
    // page meanwhile): what follows its answer does.
    open.current = null
    const stored = await store(url)
    setWork(null)
    // A failed store keeps the clip open, and its cut for another try.
    if (!stored) {
      open.current = clip
      return
    }
    discardOwn(clip)
    close()
  }

  if (candidate) {
    return <ClipEditStep key={candidate.url} parts={parts} url={candidate.url} label={candidate.label} work={work} onConfirm={(c) => void confirm(c)} onCancel={cancel} />
  }

  const linkBusy = link.state.step === "probing" || link.state.step === "downloading" || link.state.step === "range"
  return (
    <div className="flex flex-col gap-3">
      <MediaPicker
        accept="video/*"
        uploadLabel={hasSource ? "Replace clip" : "Upload clip"}
        busy={busy || uploading}
        disabled={linkBusy}
        onFiles={(files) => void fromFile(files[0]!)}
        onUrl={fromUrl}
      />
      <LinkSource parts={parts} link={link} disabled={busy || uploading} />
    </div>
  )
}

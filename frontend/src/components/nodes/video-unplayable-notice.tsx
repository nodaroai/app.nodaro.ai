"use client"

import { useState } from "react"
import { AlertCircle, Download } from "lucide-react"
import { useT } from "@/lib/i18n"
import { downloadVideoFile, showsUnplayableNotice, unproxiedUrl } from "./video-unplayable"

/**
 * A result `<video>`'s "this browser cannot play it" state (decided
 * 2026-11-22): `onError` for the element, and whether to show
 * `VideoUnplayableNotice` over it — only for a url flagged as having no
 * preview copy, and only after the player could not decode or does not
 * support THAT url (`showsUnplayableNotice`, MediaError 3/4). `onOtherError`
 * gets every other error, for the node's own failed-to-load state. The notice belongs to the url it failed on:
 * a newer url shows none until it fails itself.
 */
/** Two spellings of one stored file (the element reports it absolute, and may read it through the proxy). */
function sameUrl(a: string, b: string): boolean {
  const [x, y] = [unproxiedUrl(a), unproxiedUrl(b)]
  try {
    return new URL(x, window.location.href).href === new URL(y, window.location.href).href
  } catch {
    return x === y
  }
}

export function useVideoUnplayable(url: string | undefined, onOtherError?: () => void) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined)
  const onError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    // The element's own src at the moment it failed: an error event that
    // arrives for a url already replaced is not this url's.
    const el = e.currentTarget
    const src = el.currentSrc || el.getAttribute("src") || undefined
    if (url && src && sameUrl(src, url) && showsUnplayableNotice(el.error, url)) setFailedUrl(url)
    // Every other error is the node's, exactly as before the notice existed.
    else onOtherError?.()
  }
  return { unplayable: failedUrl !== undefined && failedUrl === url, onError }
}

/** The message and Download action shown over a result the browser cannot play. */
export function VideoUnplayableNotice({ url, label }: { url: string; label: string }) {
  const t = useT()
  return (
    <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center" data-testid="video-unplayable">
      <AlertCircle className="w-5 h-5 text-amber-400" />
      <span className="text-[11px] text-white/90">{t("node.videoCannotPlayInBrowser")}</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[11px] text-white hover:bg-white/25"
        onClick={(e) => { e.stopPropagation(); downloadVideoFile(url, label) }}
      >
        <Download className="w-3 h-3" /> {t("common.download")}
      </button>
    </div>
  )
}

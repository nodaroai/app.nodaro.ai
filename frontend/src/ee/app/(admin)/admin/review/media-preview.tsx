import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import { fetchHeldOutputBlob, type ReviewMediaKind } from "@/ee/lib/review-api"

/**
 * The held output, previewed from bytes the admin route streamed.
 *
 * There is no public URL to fall back on, by design: `hold` is the one place
 * the platform promises the output is not exposed, and a live URL survives the
 * review in browser history, in the referrer chain and in a screenshot. So the
 * bytes come down authenticated, become an object URL for exactly as long as
 * this card is mounted, and are revoked on the way out — the revoke is not
 * housekeeping, it is the end of the object's reachability in the tab.
 */
export function MediaPreview({
  jobId,
  index,
  mediaKind,
}: {
  readonly jobId: string
  readonly index: number
  readonly mediaKind: ReviewMediaKind
}) {
  const t = useT()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setSrc(null)
    setFailed(false)
    void (async () => {
      try {
        const blob = await fetchHeldOutputBlob(jobId, index)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [jobId, index])

  if (failed) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        {t("adminReview.previewFailed")}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground">
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
        {t("adminReview.previewLoading")}
      </div>
    )
  }

  // "other" is a download-only row rather than a broken <video>: a new
  // generation type classifies as "other" until it is added to the finalize
  // arrays, and a placeholder is honest where a black rectangle is not.
  if (mediaKind === "image") {
    return <img data-testid="review-media" src={src} alt="" className="max-h-64 rounded-md object-contain" />
  }
  if (mediaKind === "video") {
    return <video data-testid="review-media" src={src} controls className="max-h-64 w-full rounded-md" />
  }
  if (mediaKind === "audio") {
    return <audio data-testid="review-media" src={src} controls className="w-full" />
  }
  return (
    <a
      data-testid="review-media"
      href={src}
      download
      className="flex h-40 items-center justify-center rounded-md border text-sm underline"
    >
      {t("cfgshared.download")}
    </a>
  )
}

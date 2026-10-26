// Crop the trend's source clip to 16:9 or 9:16. Only the crop that trims is
// offered (the server's rule, shared through @nodaro/render-rules): a clip
// wider than 16:9 is cut at the sides, one taller than 9:16 at the top and
// bottom. The admin slides where the kept frame sits (centered by default);
// the preview shades what is cut and says how many pixels go from each side.
//
// The crop runs on the server, in the background (it outlasts a request), and
// keeps the original's quality (its codec family, bitrate, pixel format and
// colour tags; its sound copied): the record reads `running`, the trend is
// read again until the record is gone (the cropped clip is in the draft: the
// screen takes the server's draft) or carries an `error` (shown; dismiss it or
// crop again). One that stopped answering (a server restart) is `stale` and
// may be started again.
//
// It replaces the source clip as uploading a new one does, so a stored face
// mask must be made again: the panel says so first.

import { useEffect, useRef, useState } from "react"
import { Crop, Loader2, X } from "lucide-react"
import { TREND_CROP_DEFAULT_POSITION, trendCropAspectFor, trendCropCut, trendCropTargetSize } from "@nodaro/render-rules"
import type { AdminTrendPendingSourceCrop } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { useDismissTrendCrop, useStartTrendCrop } from "@/ee/hooks/queries/use-admin-queries"

interface Props {
  readonly trendId: string
  /** The saved source clip as shown (its display copy: rotation applied), for the preview and the shape. */
  readonly shown: { readonly videoUrl?: string; readonly posterUrl?: string; readonly width?: number; readonly height?: number }
  /** The source crop in the making or failed, as the server reads it. */
  readonly pending: AdminTrendPendingSourceCrop | null | undefined
  /** The draft revision this screen holds. */
  readonly revision: string
  /** Waits while set (the form has unsaved edits), with this reason. */
  readonly waitFor?: string
  /** A face mask is stored, which the crop makes out of date. */
  readonly faceMaskStored?: boolean
  /** A write here moved the draft: the screen adopts its revision. */
  readonly onRevision: (revision: string) => void
  /** The cropped clip is in the draft: the screen takes the draft the server now holds. */
  readonly onCropped: () => void
  /** The server wrote the draft without it (a failure on the record): the screen adopts that revision. */
  readonly onServerWrite: () => void
  readonly onWriteError: (err: Error) => void
}

export function CropPanel({ trendId, shown, pending, revision, waitFor, faceMaskStored, onRevision, onCropped, onServerWrite, onWriteError }: Props) {
  const start = useStartTrendCrop(trendId)
  const dismiss = useDismissTrendCrop(trendId)
  const [position, setPosition] = useState(TREND_CROP_DEFAULT_POSITION)

  // Watched from the click (or a reload that finds it running) until the server's record is gone or carries an error.
  const running = !!pending?.running
  const [startedHere, setStartedHere] = useState(false)
  const watching = useRef(false)
  if (running) watching.current = true
  const cropped = useRef(onCropped)
  cropped.current = onCropped
  const wrote = useRef(onServerWrite)
  wrote.current = onServerWrite
  useEffect(() => {
    if (!startedHere && !watching.current) return
    // Still running. (The click's mutation reads the trend again before it settles, so the record is there by now.)
    if (pending?.running) return
    watching.current = false
    setStartedHere(false)
    if (!pending) cropped.current()
    else wrote.current()
  }, [startedHere, pending])

  const width = shown.width
  const height = shown.height
  const aspect = trendCropAspectFor(width, height)
  if (!aspect && !pending) return null

  const busy = start.isPending || dismiss.isPending || running || startedHere
  const error = !running ? pending?.error : undefined
  const sides = aspect === "16:9" ? (["left", "right"] as const) : (["top", "bottom"] as const)
  const cut = aspect && width && height ? trendCropCut(width, height, aspect, position) : null
  const target = aspect && width && height ? trendCropTargetSize(width, height, aspect) : null
  const total = cut ? cut.before + cut.after : 0
  const span = aspect === "16:9" ? width : height
  const pct = (px: number) => (span ? `${(px / span) * 100}%` : "0%")

  const begin = () =>
    aspect &&
    start.mutate(
      { aspect, position, revision },
      {
        onSuccess: (w) => {
          onRevision(w.revision)
          setStartedHere(true)
        },
        onError: onWriteError,
      },
    )

  const drop = () =>
    dismiss.mutate({ revision }, { onSuccess: (w) => onRevision(w.revision), onError: onWriteError })

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-xs" role="group" aria-label="Crop the source clip">
      {aspect && cut && target && (
        <>
          <p className="text-sm">
            The source clip is {width}×{height}, {aspect === "16:9" ? "wider than 16:9" : "taller than 9:16"}. Crop it to {aspect} ({target.width}×{target.height}):
          </p>
          <div
            className="relative w-full max-w-md overflow-hidden rounded bg-black"
            style={{ aspectRatio: `${width} / ${height}` }}
            data-testid="crop-preview"
          >
            {shown.videoUrl ? (
              <video src={shown.videoUrl} poster={shown.posterUrl} muted playsInline preload="metadata" aria-label="The source clip" className="absolute inset-0 h-full w-full object-fill" />
            ) : shown.posterUrl ? (
              <img src={shown.posterUrl} alt="The source clip" className="absolute inset-0 h-full w-full object-fill" />
            ) : null}
            {/* What is cut, shaded; the kept frame outlined. */}
            {aspect === "16:9" ? (
              <>
                <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(cut.before) }} />
                <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: pct(cut.after) }} />
                <div className="absolute inset-y-0 border-2 border-white/90" style={{ left: pct(cut.before), right: pct(cut.after) }} />
              </>
            ) : (
              <>
                <div className="absolute inset-x-0 top-0 bg-black/60" style={{ height: pct(cut.before) }} />
                <div className="absolute inset-x-0 bottom-0 bg-black/60" style={{ height: pct(cut.after) }} />
                <div className="absolute inset-x-0 border-2 border-white/90" style={{ top: pct(cut.before), bottom: pct(cut.after) }} />
              </>
            )}
          </div>
          <div className="flex max-w-md items-center gap-3">
            <span className="w-12 shrink-0 capitalize text-muted-foreground">{sides[0]}</span>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[Math.round(position * 100)]}
              onValueChange={([v]) => setPosition((v ?? 50) / 100)}
              disabled={busy}
              thumbAriaLabel={`Where the kept frame sits, from the ${sides[0]} to the ${sides[1]}`}
            />
            <span className="w-12 shrink-0 text-right capitalize text-muted-foreground">{sides[1]}</span>
          </div>
          <p className="text-muted-foreground" data-testid="crop-split">
            Cuts {cut.before} px from the {sides[0]} ({total ? Math.round((cut.before / total) * 100) : 0} %) and {cut.after} px from the {sides[1]} (
            {total ? 100 - Math.round((cut.before / total) * 100) : 0} %).
            {position !== TREND_CROP_DEFAULT_POSITION && (
              <>
                {" "}
                <button type="button" className="underline" disabled={busy} onClick={() => setPosition(TREND_CROP_DEFAULT_POSITION)}>
                  Center it
                </button>
              </>
            )}
          </p>
          <p className="text-amber-700 dark:text-amber-400" data-testid="crop-warning">
            Cropping replaces the source clip (and its display copy) in the draft, keeping the original's quality.
            {faceMaskStored ? " The face mask will need to be made again." : ""}
          </p>
        </>
      )}

      {(running || startedHere) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="crop-running">
          <Loader2 className="h-4 w-4 animate-spin" /> Cropping the source clip to {pending?.aspect ?? aspect}… This runs on the server; you can leave this page.
        </p>
      )}
      {pending?.stale && (
        <p className="text-sm text-amber-700 dark:text-amber-400">The last crop stopped before it finished (the server may have restarted). Crop again.</p>
      )}
      {error && <p className="text-sm text-destructive">Couldn't crop the source clip: {error.message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {aspect && (
          <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={busy || !!waitFor} onClick={begin}>
            {start.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Crop className="mr-1 h-4 w-4" />}
            {error || pending?.stale ? `Crop to ${aspect} again` : `Crop to ${aspect}`}
          </Button>
        )}
        {pending && !running && (
          <Button type="button" variant="ghost" size="sm" className="min-h-9" disabled={busy} onClick={drop}>
            <X className="mr-1 h-4 w-4" /> Dismiss
          </Button>
        )}
        {waitFor && <span className="text-muted-foreground">{waitFor}</span>}
      </div>
    </div>
  )
}

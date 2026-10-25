// Upscale one of the trend's videos to 1080p: the source clip or an example,
// made at 720p to cost less. "Upscale to 1080p" starts a Topaz upscale of the
// SAVED video (billed to the admin; one key per click, so a repeat of the
// click is never paid twice); the job is followed until it ends, then the
// before and after play side by side: "Use it" puts the 1080p video in the
// draft, "Discard" drops it. A video whose short side is already 1080 or more
// is offered nothing.
//
// "Use it" runs on the server, in the background (it outlasts a request): the
// record reads `applying`, the trend is read again until the record is gone
// (applied: the screen takes the server's draft) or carries an `error` (shown,
// and Use it may be tried again). One stuck applying for a long time (a server
// restart) is `stale` and may be tried again too.
//
// The upscale in the making is recorded on the draft by the video it was made
// from, so after a reload the panel follows it again. One whose video was
// replaced since (`current: false`) can only be discarded.
//
// Using it on the source replaces the source clip as uploading a new one does,
// so a stored face mask must be made again: the panel says so first.

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Maximize2, X } from "lucide-react"
import type { AdminTrendPendingUpscale, AdminTrendUpscaleTarget } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { generateIdempotencyKey } from "@/lib/idempotency-key"
import { useApplyTrendUpscale, useDiscardTrendUpscale, useStartTrendUpscale, useTrendUpscaleJob } from "@/ee/hooks/queries/use-admin-queries"
import { needsUpscale } from "../model"

/** Where an upscale was put: the source clip, or the example at `index`. */
export interface UpscaleApplied {
  readonly target: "source" | "example"
  readonly index?: number
}

interface Props {
  readonly trendId: string
  readonly target: AdminTrendUpscaleTarget
  /** The saved video this would upscale. */
  readonly video: { readonly url: string; readonly width?: number; readonly height?: number }
  /** The upscale in the making for this video, as the server reads it. */
  readonly pending: AdminTrendPendingUpscale | undefined
  /** The job ids of every upscale the draft still records (one gone from here was applied). */
  readonly recorded: ReadonlySet<string>
  /** The draft revision this screen holds. */
  readonly revision: string
  /** Waits while true (the source clip: the form has unsaved edits), with this reason. */
  readonly waitFor?: string
  /** The source only: a face mask is stored, which using the upscale makes out of date. */
  readonly faceMaskStored?: boolean
  /** A write here moved the draft: the screen adopts its revision. */
  readonly onRevision: (revision: string) => void
  /** Another write landed while the job was recorded: reload the trend. */
  readonly onReload: () => void
  /** The upscale is in the draft: the screen takes the draft the server now holds. */
  readonly onApplied: (done: UpscaleApplied) => void
  /** The server wrote the draft without it (a failure on the record): the screen adopts that revision. */
  readonly onServerWrite: () => void
  readonly onWriteError: (err: Error) => void
}

const IN_FLIGHT = new Set(["pending", "queued", "processing", "running"])

export function UpscalePanel({
  trendId,
  target,
  video,
  pending,
  recorded,
  revision,
  waitFor,
  faceMaskStored,
  onRevision,
  onReload,
  onApplied,
  onServerWrite,
  onWriteError,
}: Props) {
  const start = useStartTrendUpscale(trendId)
  const apply = useApplyTrendUpscale(trendId)
  const discard = useDiscardTrendUpscale(trendId)
  // The job just started, until the trend's refetch carries it as `pending`.
  const [started, setStarted] = useState<string | null>(null)
  useEffect(() => {
    if (started !== null && pending?.jobId === started) setStarted(null)
  }, [started, pending?.jobId])
  const jobId = started ?? pending?.jobId ?? null
  const current = started !== null || pending?.current !== false
  const job = useTrendUpscaleJob(jobId)
  const what = target.target === "source" ? "the source clip" : `example ${target.index + 1}`

  // "Use it" in the background: watched from the click (or a reload that finds it running)
  // until the server's record of it is gone (applied) or carries an error.
  const serverApplying = !!pending?.applying && !pending.applying.stale
  const watching = useRef<string | null>(null)
  if (serverApplying && pending) watching.current = pending.jobId
  const [applyingHere, setApplyingHere] = useState<string | null>(null)
  const done = useRef(onApplied)
  done.current = onApplied
  const wrote = useRef(onServerWrite)
  wrote.current = onServerWrite
  const doneTarget = useRef<UpscaleApplied>({ target: target.target, ...(target.target === "example" ? { index: target.index } : {}) })
  doneTarget.current = { target: target.target, ...(target.target === "example" ? { index: target.index } : {}) }
  useEffect(() => {
    const watched = applyingHere ?? watching.current
    if (!watched) return
    // Still running on the server.
    if (pending?.jobId === watched && pending.applying && !pending.applying.stale) return
    // Gone from the draft's records: it is in the draft. Still recorded (an error, a stale mark): it is not.
    watching.current = null
    setApplyingHere(null)
    if (!recorded.has(watched)) done.current(doneTarget.current)
    else wrote.current()
  }, [applyingHere, pending, recorded])

  if (!jobId && !needsUpscale(video.width, video.height)) return null

  const j = job.data
  const running = !!jobId && (!j || IN_FLIGHT.has(j.status))
  const failed = !!j && (j.status === "failed" || j.status === "cancelled")
  const upscaledUrl = j?.status === "completed" ? (j.output_data?.videoUrl ?? null) : null
  const applying = applyingHere !== null || serverApplying
  const busy = start.isPending || apply.isPending || discard.isPending || applying
  const offer = needsUpscale(video.width, video.height)
  const canStart = offer && !busy && !waitFor && (!jobId || failed || !current)
  const applyError = !applying && pending?.jobId === jobId ? pending?.error : undefined

  const begin = () =>
    start.mutate(
      { target, revision, idempotencyKey: generateIdempotencyKey() },
      {
        onSuccess: (r) => {
          setStarted(r.jobId)
          if (r.draftMoved || !r.revision) onReload()
          else onRevision(r.revision)
        },
        onError: onWriteError,
      },
    )

  const useIt = () =>
    jobId &&
    apply.mutate(
      { jobId, revision },
      {
        onSuccess: (w) => {
          setStarted(null)
          onRevision(w.revision)
          if (w.applied) onApplied(doneTarget.current)
          else setApplyingHere(jobId)
        },
        onError: onWriteError,
      },
    )

  const drop = () =>
    jobId &&
    discard.mutate(
      { jobId, revision },
      {
        onSuccess: (w) => {
          setStarted(null)
          onRevision(w.revision)
        },
        onError: onWriteError,
      },
    )

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-xs" role="group" aria-label={`Upscale ${what}`}>
      {jobId && running && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Upscaling to 1080p…{typeof j?.progress === "number" && j.progress > 0 ? ` ${Math.round(j.progress)} %` : ""}
        </p>
      )}
      {jobId && job.error && <p className="text-sm text-destructive">{job.error.message}</p>}
      {jobId && failed && <p className="text-sm text-destructive">The upscale didn't finish: {j?.error_message || j?.status}.</p>}
      {jobId && j?.status === "completed" && !upscaledUrl && <p className="text-sm text-destructive">This upscale has no video.</p>}
      {jobId && !current && (
        <p className="text-sm text-amber-700 dark:text-amber-400">This upscale was made from a video since replaced, so it can't be used. Discard it.</p>
      )}

      {jobId && upscaledUrl && current && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <figure className="flex min-w-0 flex-col gap-1">
              <video src={video.url} controls muted playsInline preload="metadata" aria-label={`Before: ${what}`} className="max-h-56 w-full rounded bg-black object-contain" />
              <figcaption className="text-muted-foreground">
                Before{video.width && video.height ? ` · ${video.width}×${video.height}` : ""}
              </figcaption>
            </figure>
            <figure className="flex min-w-0 flex-col gap-1">
              <video src={upscaledUrl} controls muted playsInline preload="metadata" aria-label={`After: ${what} upscaled`} className="max-h-56 w-full rounded bg-black object-contain" />
              <figcaption className="text-muted-foreground">After · stored at 1080p</figcaption>
            </figure>
          </div>
          {target.target === "source" && (
            <p className="text-amber-700 dark:text-amber-400" data-testid="upscale-source-warning">
              Using it replaces the source clip (and its display copy) in the draft.
              {faceMaskStored ? " The face mask will need to be made again." : ""}
            </p>
          )}
        </>
      )}

      {applying && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="upscale-applying">
          <Loader2 className="h-4 w-4 animate-spin" /> Putting the 1080p video in the draft…
        </p>
      )}
      {pending?.applying?.stale && (
        <p className="text-sm text-amber-700 dark:text-amber-400">The last Use it stopped before it finished (the server may have restarted). Try it again.</p>
      )}
      {applyError && <p className="text-sm text-destructive">Couldn't use the upscale: {applyError.message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {jobId && upscaledUrl && current && (
          <Button type="button" size="sm" className="min-h-9" disabled={busy || !!waitFor} onClick={useIt}>
            {apply.isPending || applying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            {applyError ? "Try Use it again" : "Use it"}
          </Button>
        )}
        {offer && (!jobId || failed || !current) && (
          <Button type="button" variant="outline" size="sm" className="min-h-9" disabled={!canStart} onClick={begin}>
            {start.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Maximize2 className="mr-1 h-4 w-4" />}
            {jobId ? "Upscale again" : "Upscale to 1080p"}
          </Button>
        )}
        {jobId && !running && (
          <Button type="button" variant="ghost" size="sm" className="min-h-9" disabled={busy} onClick={drop}>
            <X className="mr-1 h-4 w-4" /> Discard
          </Button>
        )}
        {!jobId && !waitFor && <span className="text-muted-foreground">Topaz, billed to your account.</span>}
        {waitFor && <span className="text-muted-foreground">{waitFor}</span>}
      </div>
    </div>
  )
}

/**
 * The upscales whose example is gone (removed, or its video replaced): they
 * can no longer be used, only discarded. Nothing when there are none.
 */
export function StaleUpscales({
  trendId,
  stale,
  revision,
  onRevision,
  onWriteError,
}: {
  readonly trendId: string
  readonly stale: readonly AdminTrendPendingUpscale[]
  readonly revision: string
  readonly onRevision: (revision: string) => void
  readonly onWriteError: (err: Error) => void
}) {
  const discard = useDiscardTrendUpscale(trendId)
  if (stale.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs" aria-label="Upscales of removed examples">
      <p className="text-amber-700 dark:text-amber-400">
        {stale.length === 1 ? "An upscale was" : `${stale.length} upscales were`} made from an example since removed or replaced, so it can't be used.
      </p>
      <ul className="flex flex-col gap-1">
        {stale.map((u) => (
          <li key={u.jobId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all text-muted-foreground">Job {u.jobId}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9"
              disabled={discard.isPending}
              onClick={() => discard.mutate({ jobId: u.jobId, revision }, { onSuccess: (w) => onRevision(w.revision), onError: onWriteError })}
            >
              <X className="mr-1 h-4 w-4" /> Discard
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

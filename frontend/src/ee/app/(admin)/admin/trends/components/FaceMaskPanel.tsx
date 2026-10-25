// The trend's face mask: its whole SAVED source clip masked once, with the
// saved face masking settings, so the admin sees the mask before anyone pays
// for a run. "Make face mask" starts it (billed to the admin), the job is
// followed until it ends, and the masked clip plays here with its stats
// (shots, held frames, coverage): Approve stores it on the draft, Make again
// starts another. Every run of the trend then uses the approved mask instead
// of masking per run.
//
// The status chip is the server's (`faceMaskState`): none, approved, or out of
// date — the source clip or the settings changed since it was made, or the
// masking itself did (Video Mask's recipe, an environment's engine recipe).
// Publishing needs it approved and up to date.
//
// The job in the making is recorded on the draft, so after a reload the panel
// follows it again. One started for settings since changed (or a source clip
// since replaced) is shown as made from older settings, with Make again only.
//
// It acts on the SAVED draft, so it waits while the form has unsaved edits.

import { useEffect, useState } from "react"
import { Check, Loader2, RefreshCw, ScanFace, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  AdminTrendFaceMask,
  AdminTrendFaceMaskState,
  AdminTrendFaceMaskStats,
  AdminTrendPendingFaceMaskJob,
} from "@/lib/api"
import {
  useApproveTrendFaceMask,
  useClearTrendFaceMask,
  useStartTrendFaceMask,
  useTrendFaceMaskJob,
} from "@/ee/hooks/queries/use-admin-queries"
import { describeFaceMaskOutOfDate } from "../model"

interface Props {
  readonly trendId: string
  /** The saved draft's mask, if any. */
  readonly faceMask: AdminTrendFaceMask | undefined
  readonly state: AdminTrendFaceMaskState | undefined
  /** The job being made, recorded on the draft (the server's reading of it). */
  readonly pending: AdminTrendPendingFaceMaskJob | null | undefined
  /** The saved draft has a source clip and masks faces. */
  readonly ready: boolean
  readonly dirty: boolean
  /** The draft revision this screen holds. */
  readonly revision: string
  /** A write here moved the draft: the screen adopts its revision. */
  readonly onRevision: (revision: string) => void
  /** Another write landed while the job was recorded: reload the trend. */
  readonly onReload: () => void
  readonly onWriteError: (err: Error) => void
}

const CHIP: Readonly<Record<AdminTrendFaceMaskState["status"], { label: string; className: string }>> = {
  none: { label: "No face mask", className: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  out_of_date: { label: "Out of date", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
}

const IN_FLIGHT = new Set(["pending", "queued", "processing", "running"])

export function FaceMaskPanel({ trendId, faceMask, state, pending, ready, dirty, revision, onRevision, onReload, onWriteError }: Props) {
  const start = useStartTrendFaceMask(trendId)
  const approve = useApproveTrendFaceMask(trendId)
  const clear = useClearTrendFaceMask(trendId)
  // The job just started, until the trend's refetch carries it as `pending`: from then on the
  // server's reading of it wins (a settings save makes it not current).
  const [started, setStarted] = useState<string | null>(null)
  useEffect(() => {
    if (started !== null && pending?.jobId === started) setStarted(null)
  }, [started, pending?.jobId])
  const startedHere = started !== null && pending?.jobId !== started ? started : null
  const jobId = startedHere ?? pending?.jobId ?? null
  // A job just started here is for the saved settings; a recorded one is as the server reads it.
  const current = startedHere !== null || pending?.current !== false
  const job = useTrendFaceMaskJob(jobId)
  const status = state?.status ?? (faceMask ? "approved" : "none")
  const chip = CHIP[status]

  const make = () =>
    start.mutate(revision, {
      onSuccess: (r) => {
        setStarted(r.jobId)
        if (r.draftMoved || !r.revision) onReload()
        else onRevision(r.revision)
      },
      onError: onWriteError,
    })

  const j = job.data
  const running = !!jobId && (!j || IN_FLIGHT.has(j.status))
  const maskedUrl = j?.status === "completed" ? (j.output_data?.maskedUrl ?? null) : null
  const approvable = !!maskedUrl && current
  // A job made from older settings never holds back a new one.
  const busy = start.isPending || (running && current) || approve.isPending || clear.isPending
  const canMake = ready && !dirty && !busy

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" aria-label="Face mask">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Face mask</span>
        <span data-testid="face-mask-status" className={cn("rounded px-2 py-0.5 text-xs font-medium", chip.className)}>
          {chip.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        The whole source clip, masked once with these settings. Every run then uses the approved mask instead of masking
        again, and the trend can't be published without one. Making it is billed to your account.
      </p>

      {status === "out_of_date" && state && state.reasons.length > 0 && (
        <ul aria-label="Why the face mask is out of date" className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
          {state.reasons.map((r, i) => (
            <li key={i}>{capitalize(describeFaceMaskOutOfDate(r))}</li>
          ))}
        </ul>
      )}

      {faceMask && (!jobId || !current) && (
        <MaskResult url={faceMask.url} stats={faceMask.stats} label="The approved face mask" />
      )}

      {jobId && running && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Masking the clip…{typeof j?.progress === "number" && j.progress > 0 ? ` ${Math.round(j.progress)} %` : ""}
        </p>
      )}
      {jobId && job.error && <p className="text-sm text-destructive">{job.error.message}</p>}
      {jobId && j && (j.status === "failed" || j.status === "cancelled") && (
        <p className="text-sm text-destructive">The face mask didn't finish: {j.error_message || j.status}.</p>
      )}
      {jobId && j?.status === "completed" && !maskedUrl && (
        <p className="text-sm text-muted-foreground">
          {j.output_data?.reason === "no_faces"
            ? "No face was found to cover with these settings, so there is no mask to approve."
            : "This job has no masked clip."}
        </p>
      )}
      {jobId && maskedUrl && (
        <MaskResult url={maskedUrl} stats={statsOf(j?.output_data?.stats)} label="The new face mask" />
      )}
      {jobId && !current && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This mask was made from older settings or another source clip, so it can't be approved. Make it again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {jobId && approvable && (
          <Button
            type="button"
            className="min-h-9"
            disabled={dirty || approve.isPending}
            onClick={() =>
              approve.mutate(
                { jobId, revision },
                {
                  onSuccess: (w) => {
                    onRevision(w.revision)
                    setStarted(null)
                    toast.success("Face mask approved")
                  },
                  onError: onWriteError,
                },
              )
            }
          >
            {approve.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            Approve
          </Button>
        )}
        <Button type="button" variant={jobId || faceMask ? "outline" : "default"} className="min-h-9" disabled={!canMake} onClick={make}>
          {start.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : jobId || faceMask ? (
            <RefreshCw className="mr-1 h-4 w-4" />
          ) : (
            <ScanFace className="mr-1 h-4 w-4" />
          )}
          {jobId || faceMask ? "Make again" : "Make face mask"}
        </Button>
        {faceMask && (!jobId || !current) && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-9"
            disabled={dirty || clear.isPending}
            onClick={() =>
              clear.mutate(revision, {
                onSuccess: (w) => {
                  onRevision(w.revision)
                  toast.success("Face mask removed")
                },
                onError: onWriteError,
              })
            }
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove
          </Button>
        )}
        {dirty && <span className="text-xs text-muted-foreground">Save first: the face mask is made from the saved draft.</span>}
        {!dirty && !ready && <span className="text-xs text-muted-foreground">Needs a saved source clip and face masking on.</span>}
      </div>
    </div>
  )
}

function MaskResult({ url, stats, label }: { readonly url: string; readonly stats: AdminTrendFaceMaskStats; readonly label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <video src={url} controls muted playsInline aria-label={label} className="max-h-80 w-full rounded-md bg-black object-contain" />
      <p className="text-xs tabular-nums text-muted-foreground" data-testid="face-mask-stats">
        {plural(stats.shots, "shot")} · {plural(stats.heldFrames, "held frame")} · {(stats.coverage * 100).toFixed(1)} % covered
        {stats.droppedRegions > 0 ? ` · ${plural(stats.droppedRegions, "region")} left out` : ""}
      </p>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)

function statsOf(s: Partial<AdminTrendFaceMaskStats> | undefined): AdminTrendFaceMaskStats {
  return { shots: num(s?.shots), heldFrames: num(s?.heldFrames), coverage: num(s?.coverage), droppedRegions: num(s?.droppedRegions) }
}

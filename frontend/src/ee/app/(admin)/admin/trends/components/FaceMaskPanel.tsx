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
//
// Marks (decided 2026-10-26): on the mask shown, boxes over faces the mask
// should leave uncovered, each over a range of frames (FaceMaskMarks.tsx).
// "Apply edits" saves them on the draft and makes the mask again; while the
// approved mask kept its mask from before any mark, the faces are not found
// again (a cheaper re-make). One approved before marks existed kept none, so
// the first edit makes the whole mask once, and the panel says so. A box may be
// for one optional person (decided 2026-10-27): those faces are left uncovered
// only in the person masks (FaceMaskVariants.tsx) — saving them leaves the
// approved face mask as it is.

import { useEffect, useState } from "react"
import { Check, Eraser, Loader2, RefreshCw, ScanFace, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type {
  AdminTrendFaceMask,
  AdminTrendFaceMaskMark,
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
import { faceMaskMarkSlot } from "@nodaro/render-rules"
import { describeFaceMaskOutOfDate } from "../model"
import { FaceMaskMarksEditor, type MarkPerson } from "./FaceMaskMarks"
import { FaceMaskVariants } from "./FaceMaskVariants"

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
  /** The SAVED draft's marks (faces left unmasked). */
  readonly marks?: readonly AdminTrendFaceMaskMark[]
  /**
   * Save `marks` on the draft (the page's save, so the form keeps them): the
   * new revision and the face mask's state after the save, or null when it did not save.
   */
  readonly onSaveMarks?: (marks: AdminTrendFaceMaskMark[]) => Promise<{ revision: string; faceMaskState?: AdminTrendFaceMaskState } | null>
  /** Whether this environment's engine makes a face mask with marks (false: the editor is shown disabled, with why). */
  readonly marksSupported?: boolean
  /** The trend's optional people (a box may be for one of them). */
  readonly people?: readonly MarkPerson[]
  /** The saved draft has examples (an empty optional slot then takes an example's person). */
  readonly hasExamples?: boolean
  /** The clip keeps its people (Keep people): the marks leave a person out, or mark the main character. */
  readonly keepPeople?: boolean
}

/**
 * The optional people with no face marks of their own: on a masked trend with
 * no examples, each stays blurred when a run leaves them empty (only a marked
 * person keeps their face). Publishing is not held for it.
 */
export function unmarkedPeople(people: readonly MarkPerson[], marks: readonly AdminTrendFaceMaskMark[]): MarkPerson[] {
  return people.filter((p) => !marks.some((m) => faceMaskMarkSlot(m) === p.key))
}

const NO_PEOPLE: readonly MarkPerson[] = []

const CHIP: Readonly<Record<AdminTrendFaceMaskState["status"], { label: string; className: string }>> = {
  none: { label: "No face mask", className: "bg-muted text-muted-foreground" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  out_of_date: { label: "Out of date", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
}

const IN_FLIGHT = new Set(["pending", "queued", "processing", "running"])

const NO_MARKS: readonly AdminTrendFaceMaskMark[] = []

export function FaceMaskPanel({
  trendId,
  faceMask,
  state,
  pending,
  ready,
  dirty,
  revision,
  onRevision,
  onReload,
  onWriteError,
  marks: savedMarks = NO_MARKS,
  onSaveMarks,
  marksSupported = false,
  people = NO_PEOPLE,
  hasExamples = false,
  keepPeople = false,
}: Props) {
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

  // The marks being edited here, from the saved ones (and again whenever those change).
  const savedKey = JSON.stringify(savedMarks)
  const [marks, setMarks] = useState<AdminTrendFaceMaskMark[]>(() => savedMarks.map((m) => ({ ...m })))
  useEffect(() => setMarks(JSON.parse(savedKey) as AdminTrendFaceMaskMark[]), [savedKey])
  const marksEdited = JSON.stringify(marks) !== savedKey
  const [applying, setApplying] = useState(false)

  const make = (at: string = revision) =>
    start.mutate(at, {
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
  const busy = start.isPending || (running && current) || approve.isPending || clear.isPending || applying
  const canMake = ready && !dirty && !busy
  // The mask the marks are drawn on: the new one when it is for these settings, else the approved one.
  const shown = maskedUrl && current
    ? { url: maskedUrl, frames: typeof j?.output_data?.frames === "number" ? j.output_data.frames : (faceMask?.frames ?? 0), fps: undefined, label: "The new face mask" }
    : faceMask && (!jobId || !current)
      ? { url: faceMask.url, frames: faceMask.frames, fps: faceMask.fps, label: "The approved face mask" }
      : null
  const editable = !!onSaveMarks && !!shown && shown.frames > 0
  // An approved mask that kept no mask from before the marks: the first edit finds the faces again.
  const fullMakeFirst = !!faceMask && !faceMask.rawMaskUrl

  const applyEdits = async () => {
    if (!onSaveMarks) return
    setApplying(true)
    try {
      const saved = await onSaveMarks(marks)
      if (!saved) return
      // The approved mask already the one for these marks (every mark removed and it was made without any,
      // or only people's boxes changed — they never shape it): saved, nothing to make.
      if (saved.faceMaskState?.status === "approved") {
        onRevision(saved.revision)
        toast.success(
          marks.length === 0
            ? "Marks removed: the approved face mask already leaves no face unmasked"
            : "Marks saved: the approved face mask already matches them. Make the person masks next.",
        )
        return
      }
      make(saved.revision)
    } finally {
      setApplying(false)
    }
  }

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

      {ready && !hasExamples && unmarkedPeople(people, savedMarks).length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="face-mask-unmarked-people">
          {unmarkedPeople(people, savedMarks)
            .map((p) => p.label)
            .join(", ")}{" "}
          {unmarkedPeople(people, savedMarks).length === 1 ? "has" : "have"} no person marks, so a run that leaves{" "}
          {unmarkedPeople(people, savedMarks).length === 1 ? "this person" : "one of them"} empty keeps them blurred. Mark their face as theirs
          (New boxes are for → their name) to keep them as in the clip.
        </p>
      )}
      {status === "out_of_date" && state && state.reasons.length > 0 && (
        <ul aria-label="Why the face mask is out of date" className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
          {state.reasons.map((r, i) => (
            <li key={i}>{capitalize(describeFaceMaskOutOfDate(r))}</li>
          ))}
        </ul>
      )}

      {faceMask && (!jobId || !current) && (
        <MaskResult url={faceMask.url} stats={faceMask.stats} label="The approved face mask" editor={editable} />
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
        <MaskResult url={maskedUrl} stats={statsOf(j?.output_data?.stats)} label="The new face mask" editor={editable && current} />
      )}
      {editable && shown && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2" aria-label="Face mask marks">
          <span className="text-xs font-medium">{keepPeople ? "Marked people" : "Faces left unmasked"}</span>
          <FaceMaskMarksEditor url={shown.url} label={shown.label} frames={shown.frames} fps={shown.fps} marks={marks} onChange={setMarks} disabled={busy || !marksSupported} people={people} keepPeople={keepPeople} />
          {!marksSupported && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This environment's Cast Swap engine cannot leave faces unmasked yet, so marks can't be added or changed here.
            </p>
          )}
          {marksEdited && fullMakeFirst && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This approved mask kept no copy from before the marks, so the first edit makes the whole mask again (the faces are found once more).
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="min-h-9" disabled={!marksEdited || !ready || dirty || busy || !marksSupported} onClick={() => void applyEdits()}>
              {applying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Eraser className="mr-1 h-4 w-4" />}
              Apply edits
            </Button>
            {marksEdited && (
              <Button type="button" variant="ghost" className="min-h-9" disabled={busy} onClick={() => setMarks(JSON.parse(savedKey) as AdminTrendFaceMaskMark[])}>
                Discard
              </Button>
            )}
            {marksEdited && <span className="text-xs text-muted-foreground">Saves the marks on the draft, then makes the mask again (billed to your account).</span>}
          </div>
        </div>
      )}
      <FaceMaskVariants
        trendId={trendId}
        state={state?.variants}
        people={people}
        dirty={dirty || marksEdited}
        revision={revision}
        onRevision={onRevision}
        onWriteError={onWriteError}
      />
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
        <Button type="button" variant={jobId || faceMask ? "outline" : "default"} className="min-h-9" disabled={!canMake} onClick={() => make()}>
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

/** The mask's player and stats; with `editor`, the marks editor (below) plays it, so only the stats show here. */
function MaskResult({ url, stats, label, editor }: { readonly url: string; readonly stats: AdminTrendFaceMaskStats; readonly label: string; readonly editor?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {!editor && <video src={url} controls muted playsInline aria-label={label} className="max-h-80 w-full rounded-md bg-black object-contain" />}
      <p className="text-xs tabular-nums text-muted-foreground" data-testid="face-mask-stats">
        {plural(stats.shots, "shot")} · {plural(stats.heldFrames, "held frame")} · {(stats.coverage * 100).toFixed(1)} % covered
        {stats.droppedRegions > 0 ? ` · ${plural(stats.droppedRegions, "region")} left out` : ""}
        {(stats.erasedRegions ?? 0) > 0 ? ` · ${plural(stats.erasedRegions ?? 0, "face")} left unmasked` : ""}
      </p>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)

function statsOf(s: Partial<AdminTrendFaceMaskStats> | undefined): AdminTrendFaceMaskStats {
  return {
    shots: num(s?.shots),
    heldFrames: num(s?.heldFrames),
    coverage: num(s?.coverage),
    droppedRegions: num(s?.droppedRegions),
    ...(s?.erasedRegions !== undefined ? { erasedRegions: num(s.erasedRegions) } : {}),
  }
}

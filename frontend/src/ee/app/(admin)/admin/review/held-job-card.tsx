import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import {
  ReviewApiError,
  approveHeldJob,
  getHeldJob,
  rejectHeldJob,
  type HeldJobSummary,
} from "@/ee/lib/review-api"
import { MediaPreview } from "./media-preview"

/** Every mutation on this page invalidates this prefix, so the queue, the
 *  decisions log and the nav badge all catch up from one resolution. */
export const REVIEW_QUERY_KEY = ["admin", "review"] as const

/** Two admins, one job, one browser tab each is a NORMAL outcome, not a fault:
 *  the loser gets a 409 and the queue simply catches up. Anything else really
 *  did fail, and the copy says nothing changed — which is true, because the
 *  route leaves a job at `pending_review` on every failure path. */
function useResolveFeedback() {
  const t = useT()
  const queryClient = useQueryClient()
  return {
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEW_QUERY_KEY })
    },
    onError: (err: unknown) => {
      if (err instanceof ReviewApiError && err.code === "review_already_resolved") {
        toast.info(t("adminReview.alreadyResolved"))
        return
      }
      toast.error(t("adminReview.actionFailed"))
    },
  }
}

function RequestDetails({ jobId }: { readonly jobId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: [...REVIEW_QUERY_KEY, "job", jobId],
    queryFn: () => getHeldJob(jobId),
  })
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />
  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
      {JSON.stringify(data?.inputData ?? {}, null, 2)}
    </pre>
  )
}

export function HeldJobCard({ job }: { readonly job: HeldJobSummary }) {
  const t = useT()
  const feedback = useResolveFeedback()
  const [confirmingApprove, setConfirmingApprove] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [showInput, setShowInput] = useState(false)

  const approve = useMutation({
    mutationFn: () => approveHeldJob(job.jobId),
    onSuccess: () => {
      toast.success(t("adminReview.approved"))
      setConfirmingApprove(false)
    },
    ...feedback,
  })

  const reject = useMutation({
    mutationFn: (text: string) => rejectHeldJob(job.jobId, text),
    onSuccess: () => {
      toast.success(t("adminReview.rejected"))
      setRejecting(false)
      setReason("")
    },
    ...feedback,
  })

  const busy = approve.isPending || reject.isPending
  const reasonReady = reason.trim().length > 0 && reason.trim().length <= 500

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full md:w-64">
          <MediaPreview jobId={job.jobId} index={0} mediaKind={job.mediaKind} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("adminReview.jobType")}</dt>
              <dd className="truncate">{job.jobType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("adminReview.owner")}</dt>
              <dd className="truncate font-mono text-xs">{job.userId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("adminReview.heldFor", { n: job.heldForMinutes })}</dt>
              <dd>{t("adminReview.creditsHeld", { n: job.credits })}</dd>
            </div>
          </dl>

          <div className="rounded-md bg-muted/50 p-2 text-sm">
            <span className="text-xs text-muted-foreground">{t("adminReview.policyLabel")}: </span>
            <span className="font-medium">{job.policyId ?? "—"}</span>
            <div className="mt-1">
              <span className="text-xs text-muted-foreground">{t("adminReview.reasonLabel")}: </span>
              {/* The policy's MACHINE reason, operator-facing. It is not what
                  the requester sees — that text is the reviewer's own. */}
              <span className="whitespace-pre-wrap break-words font-mono text-xs">{job.reason ?? "—"}</span>
            </div>
          </div>

          <div>
            <button
              type="button"
              className="text-xs underline text-muted-foreground"
              onClick={() => setShowInput((v) => !v)}
            >
              {t("adminReview.showInput")}
            </button>
            {/* Collapsed by default: input_data can carry the prompt that
                produced the held content. */}
            {showInput && <RequestDetails jobId={job.jobId} />}
          </div>

          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => setConfirmingApprove(true)}>
              {t("adminReview.approve")}
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setRejecting(true)}>
              {t("adminReview.reject")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={confirmingApprove} onOpenChange={setConfirmingApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminReview.approveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("adminReview.approveConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingApprove(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
              {t("adminReview.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adminReview.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("adminReview.rejectBody")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("adminReview.reasonPlaceholder")}
          />
          {/* The honesty label. This text becomes error_hint.reason, which is
              on PUBLIC_JOB_KEYS and lands verbatim on the requester's canvas. */}
          <p className="text-xs text-muted-foreground">{t("adminReview.reasonShownToUser")}</p>
          {!reasonReady && <p className="text-xs text-destructive">{t("adminReview.reasonRequired")}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!reasonReady || reject.isPending}
              onClick={() => reject.mutate(reason.trim())}
            >
              {t("adminReview.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

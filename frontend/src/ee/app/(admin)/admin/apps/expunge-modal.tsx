import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { AdminApp } from "@/ee/hooks/queries/use-admin-queries"
import { expungeApp } from "@/lib/api"
import { interpolateNodes, useT, type MessageKey } from "@/lib/i18n"

/**
 * What the expunge erases, item by item — kept in step with the backend's
 * lists (`backend/src/lib/app-run-content.ts`): each run's own columns, every
 * workflow execution of the run, and those executions' jobs. A run still in
 * flight is skipped. Decided 2026-10-06. Jobs' error messages and each
 * component run's own run record are erased too; executions from before runs
 * were tagged are not found, and keep their content (decided 2026-10-07).
 * Each execution's own error message, which repeats a child job's, is erased
 * too (decided 2026-10-07).
 *
 * PRESERVED is only what a legal or audit obligation keeps — its heading says
 * so. The untagged executions are kept because nothing ties them to the run,
 * so they are a note after the lists (`adminExpunge.preservedUntagged`), not a
 * PRESERVED item.
 */
const DELETED: readonly MessageKey[] = [
  "adminExpunge.deletedApp",
  "adminExpunge.deletedBookmarks",
  "adminExpunge.deletedRuns",
  "adminExpunge.deletedExecutions",
  "adminExpunge.deletedJobs",
  "adminExpunge.deletedReports",
  "adminExpunge.deletedFiles",
]

const PRESERVED: readonly MessageKey[] = [
  "adminExpunge.preservedEarnings",
  "adminExpunge.preservedRecords",
  "adminExpunge.preservedUploads",
  "adminExpunge.preservedAudit",
]

export function ExpungeModal({ app, onClose }: { app: AdminApp; onClose: () => void }) {
  const t = useT()
  const [reason, setReason] = useState("")
  const [typedSlug, setTypedSlug] = useState("")
  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: () => expungeApp(app.id, reason),
    onSuccess: (data) => {
      // Runs still in flight are skipped and the MiniApp stays soft-deleted
      // for another pass (decided 2026-10-06).
      const summary =
        data.runsSkipped > 0
          ? t("adminExpunge.partial", {
              erased: data.runsErased,
              skipped: data.runsSkipped,
              deleted: data.r2KeysDeleted,
              errors: data.r2Errors,
            })
          : t("adminExpunge.success", { deleted: data.r2KeysDeleted, errors: data.r2Errors })
      // Runs from before the run tag may have earlier executions the expunge
      // could not find (decided 2026-10-07): say how many, so the admin knows.
      const notes = [
        ...(data.runsBeforeRunTag > 0 ? [t("adminExpunge.untaggedNote", { count: data.runsBeforeRunTag })] : []),
        ...(data.auditWarning ? [t("adminExpunge.auditWarning")] : []),
      ]
      toast.success([summary, ...notes].join("\n\n"))
      qc.invalidateQueries({ queryKey: ["admin", "apps"] })
      onClose()
    },
    onError: (err: Error) => toast.error(t("adminExpunge.failed", { message: err.message })),
  })

  const canSubmit = reason.length >= 10 && typedSlug === app.slug && !mut.isPending

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("adminExpunge.title", { name: app.name })}</DialogTitle>
          <DialogDescription>{t("adminExpunge.cannotUndo")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2 text-sm">
          <div>
            <p className="font-medium mb-1">{t("adminExpunge.deletedHeading")}</p>
            <ul className="space-y-0.5 ms-5 list-disc text-muted-foreground">
              {DELETED.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium mb-1">{t("adminExpunge.preservedHeading")}</p>
            <ul className="space-y-0.5 ms-5 list-disc text-muted-foreground">
              {PRESERVED.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{t("adminExpunge.preservedUntagged")}</p>
          <p className="text-xs text-muted-foreground">{t("adminExpunge.inProgressNote")}</p>

          <div className="space-y-1.5 pt-2">
            <label htmlFor="expunge-reason" className="font-medium">
              {t("adminExpunge.reason")}
            </label>
            <Textarea
              id="expunge-reason"
              placeholder={t("adminExpunge.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              minLength={10}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">{t("adminExpunge.reasonCount", { count: reason.length })}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="expunge-slug" className="font-medium">
              {interpolateNodes(t("adminExpunge.confirmSlug"), {
                slug: <code className="text-xs px-1 py-0.5 bg-muted rounded">{app.slug}</code>,
              })}
            </label>
            <Input
              id="expunge-slug"
              className="font-mono"
              value={typedSlug}
              onChange={(e) => setTypedSlug(e.target.value)}
              placeholder={app.slug}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => mut.mutate()}>
            {mut.isPending ? t("adminExpunge.submitting") : t("adminExpunge.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

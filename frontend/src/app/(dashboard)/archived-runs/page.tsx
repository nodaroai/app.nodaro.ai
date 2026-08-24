import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Archive, RotateCcw, Trash2, ImageIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { useT, formatRelative } from "@/lib/i18n"
import { queryKeys } from "@/lib/query-keys"
import { optimizedImageUrl } from "@/lib/image"
import {
  getArchivedRuns,
  restoreAppRun,
  permanentlyDeleteAppRun,
  type ArchivedAppRun,
} from "@/lib/api"

export default function ArchivedRunsPage() {
  const t = useT()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState<ArchivedAppRun | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.archivedRuns.list(),
    queryFn: () => getArchivedRuns(),
    enabled: !!user,
  })

  const restoreMutation = useMutation({
    mutationFn: ({ slug, runId }: { slug: string; runId: string }) => restoreAppRun(slug, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.archivedRuns.all })
      toast.success(t("archive.runRestored"))
    },
    onError: () => toast.error(t("archive.failedRestore")),
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: ({ slug, runId }: { slug: string; runId: string }) => permanentlyDeleteAppRun(slug, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.archivedRuns.all })
      toast.success(t("archive.runDeleted"))
      setConfirmDelete(null)
    },
    onError: () => {
      toast.error(t("archive.failedDelete"))
      setConfirmDelete(null)
    },
  })

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{t("archive.signInToView")}</p>
      </div>
    )
  }

  const runs = data?.data ?? []

  return (
    <div className="container max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Archive className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("archive.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("archive.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t("archive.failedToLoad")}
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">{t("archive.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
            >
              <div className="h-16 w-16 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                {run.thumbnailUrl ? (
                  <img src={optimizedImageUrl(run.thumbnailUrl)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-medium truncate">{run.name || run.appName || t("archive.untitledRun")}</span>
                  {run.appSlug && run.appName && run.name && (
                    <Link
                      to={`/app/${run.appSlug}`}
                      className="text-xs text-muted-foreground hover:underline shrink-0"
                    >
                      {run.appName}
                    </Link>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("archive.archived", { time: formatRelative(run.deletedAt) })} · {t("archive.ran", { time: formatRelative(run.createdAt) })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run.appSlug && restoreMutation.mutate({ slug: run.appSlug, runId: run.id })}
                  disabled={!run.appSlug || restoreMutation.isPending}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  {t("archive.restore")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(run)}
                  disabled={!run.appSlug}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t("archive.deleteForever")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("archive.deleteForeverTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("archive.deleteForeverDesc")}
          </p>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} autoFocus>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirmDelete?.appSlug) return
                permanentDeleteMutation.mutate({ slug: confirmDelete.appSlug, runId: confirmDelete.id })
              }}
              disabled={permanentDeleteMutation.isPending}
            >
              {t("archive.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

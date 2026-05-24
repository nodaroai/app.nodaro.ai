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
import { queryKeys } from "@/lib/query-keys"
import { optimizedImageUrl } from "@/lib/image"
import {
  getArchivedRuns,
  restoreAppRun,
  permanentlyDeleteAppRun,
  type ArchivedAppRun,
} from "@/lib/api"

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

export default function ArchivedRunsPage() {
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
      toast.success("Run restored")
    },
    onError: () => toast.error("Failed to restore run"),
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: ({ slug, runId }: { slug: string; runId: string }) => permanentlyDeleteAppRun(slug, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.archivedRuns.all })
      toast.success("Run permanently deleted")
      setConfirmDelete(null)
    },
    onError: () => {
      toast.error("Failed to delete run")
      setConfirmDelete(null)
    },
  })

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your archived runs.</p>
      </div>
    )
  }

  const runs = data?.data ?? []

  return (
    <div className="container max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Archive className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Archived runs</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Runs you've archived from any app appear here. Restore them to bring them back, or permanently delete to free up storage. Permanent deletion cannot be undone.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load archived runs.
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Your archive is empty.</p>
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
                  <span className="font-medium truncate">{run.name || run.appName || "Untitled run"}</span>
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
                  Archived {formatRelative(run.deletedAt)} · ran {formatRelative(run.createdAt)}
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
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(run)}
                  disabled={!run.appSlug}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete forever
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently delete run?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the run, its inputs, and its generated outputs. This action cannot be undone.
          </p>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} autoFocus>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirmDelete?.appSlug) return
                permanentDeleteMutation.mutate({ slug: confirmDelete.appSlug, runId: confirmDelete.id })
              }}
              disabled={permanentDeleteMutation.isPending}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

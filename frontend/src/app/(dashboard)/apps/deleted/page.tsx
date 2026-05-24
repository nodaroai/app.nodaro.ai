import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Archive, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { getMyApps, restoreApp } from "@/lib/api"
import { formatRelative } from "@/lib/utils"
import { optimizedImageUrl } from "@/lib/image"

export default function DeletedAppsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: allApps, isLoading, error } = useQuery({
    queryKey: ["my-apps"],
    queryFn: () => getMyApps(),
    select: (apps) =>
      apps
        .filter((a) => a.deletedAt != null)
        .sort(
          (a, b) =>
            new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime(),
        ),
    enabled: !!user,
  })

  const restoreMutation = useMutation({
    mutationFn: ({ appId }: { appId: string }) => restoreApp(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-apps"] })
      toast.success("App restored. It's in your apps list (unpublished).")
    },
    onError: () => toast.error("Failed to restore app"),
  })

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your deleted apps.</p>
      </div>
    )
  }

  const apps = allApps ?? []

  return (
    <div className="container max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Archive className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Deleted apps</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Apps you've deleted from your apps list appear here. Restore an app to bring it back to your apps list (it'll stay unpublished — you can re-publish from the edit page).
        </p>
        <Link
          to="/apps"
          className="text-sm text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1"
        >
          ← Back to Apps
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load deleted apps.
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No deleted apps. Apps you delete from your apps list will appear here for restoration.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
            >
              <div className="h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                {app.previewMediaUrl ? (
                  <img src={optimizedImageUrl(app.previewMediaUrl)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Archive className="h-5 w-5 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{app.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Deleted {formatRelative(app.deletedAt!)} · /app/{app.slug}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => restoreMutation.mutate({ appId: app.id })}
                disabled={restoreMutation.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

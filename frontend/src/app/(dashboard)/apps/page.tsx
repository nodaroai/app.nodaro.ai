import { useState, useCallback } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Rocket,
  ExternalLink,
  Copy,
  BarChart3,
  ToggleLeft,
  ToggleRight,
  Code2,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { getMyApps, updateApp, deactivateApp, type PublishedApp } from "@/lib/api"

export default function AppsPage() {
  const qc = useQueryClient()

  const { data: apps, isLoading } = useQuery({
    queryKey: ["my-apps"],
    queryFn: getMyApps,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ appId, isActive }: { appId: string; isActive: boolean }) => {
      if (isActive) {
        await updateApp(appId, { isActive: true })
      } else {
        await deactivateApp(appId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-apps"] })
    },
  })

  const handleCopyUrl = useCallback((slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/app/${slug}`)
    toast.success("URL copied")
  }, [])

  const handleCopyEmbed = useCallback((slug: string) => {
    const embedCode = `<iframe src="${window.location.origin}/embed/${slug}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`
    navigator.clipboard.writeText(embedCode)
    toast.success("Embed code copied")
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const activeApps = (apps ?? []).filter((a) => a.isActive !== false)
  const inactiveApps = (apps ?? []).filter((a) => a.isActive === false)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Apps</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Published mini-apps from your workflows
          </p>
        </div>
      </div>

      {(!apps || apps.length === 0) ? (
        <div className="text-center py-16">
          <Rocket className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">No published apps yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Publish a workflow as a mini-app from the presentation mode share dialog.
            Apps get their own URL, persistent run history, and analytics.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {activeApps.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  onCopyUrl={handleCopyUrl}
                  onCopyEmbed={handleCopyEmbed}
                  onToggle={(isActive) => toggleMutation.mutate({ appId: app.id, isActive })}
                />
              ))}
            </div>
          )}

          {inactiveApps.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Inactive</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                {inactiveApps.map((app) => (
                  <AppCard
                    key={app.id}
                    app={app}
                    onCopyUrl={handleCopyUrl}
                    onCopyEmbed={handleCopyEmbed}
                    onToggle={(isActive) => toggleMutation.mutate({ appId: app.id, isActive })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AppCard({
  app,
  onCopyUrl,
  onCopyEmbed,
  onToggle,
}: {
  app: PublishedApp
  onCopyUrl: (slug: string) => void
  onCopyEmbed: (slug: string) => void
  onToggle: (isActive: boolean) => void
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{app.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">/app/{app.slug}</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 ml-2">
          v{app.version}
        </span>
      </div>

      {app.description && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{app.description}</p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
        <span>{app.runCount ?? 0} runs</span>
        <span>{app.estimatedCredits ?? 0} CR/run</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => window.open(`/app/${app.slug}`, "_blank")}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onCopyUrl(app.slug)}
        >
          <Copy className="h-3 w-3 mr-1" />
          URL
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onCopyEmbed(app.slug)}
          title="Copy embed code"
        >
          <Code2 className="h-3 w-3 mr-1" />
          Embed
        </Button>
        <Link to={`/apps/${app.id}/analytics`}>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <BarChart3 className="h-3 w-3 mr-1" />
            Analytics
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 ml-auto"
          onClick={() => onToggle(!app.isActive)}
          title={app.isActive ? "Deactivate" : "Reactivate"}
        >
          {app.isActive ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>
    </div>
  )
}

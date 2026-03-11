import { useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, ExternalLink, Copy, Check, AppWindow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAdminApps, type AdminApp } from "@/hooks/queries/use-admin-queries"

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

export default function AdminAppsPage() {
  const [page, setPage] = useState(0)
  const [selectedApp, setSelectedApp] = useState<AdminApp | null>(null)
  const { data: apps = [], isLoading } = useAdminApps(page, 50)

  if (isLoading && apps.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Published Apps</h1>
        <span className="text-sm text-muted-foreground">{apps.length} apps</span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Creator</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Version</th>
              <th className="text-left px-4 py-2 font-medium">Credits</th>
              <th className="text-left px-4 py-2 font-medium">Runs</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-left px-4 py-2 font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            {(apps as AdminApp[]).map((app) => (
              <tr key={app.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedApp(app)}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {app.icon_url ? (
                      <img src={app.icon_url} alt="" className="w-6 h-6 rounded" />
                    ) : (
                      <AppWindow className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">{app.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{app.creator_email}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <Badge variant={app.is_active ? "default" : "secondary"}>
                      {app.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {app.is_listed && <Badge variant="outline">Listed</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2">v{app.version}</td>
                <td className="px-4 py-2">{app.estimated_credits ?? "-"}</td>
                <td className="px-4 py-2">{app.run_count}</td>
                <td className="px-4 py-2 text-muted-foreground">{timeAgo(app.created_at)}</td>
                <td className="px-4 py-2">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setSelectedApp(app) }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {apps.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No published apps found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={apps.length < 50} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>

      {/* App detail dialog */}
      <Dialog open={!!selectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedApp?.icon_url ? (
                <img src={selectedApp.icon_url} alt="" className="w-6 h-6 rounded" />
              ) : (
                <AppWindow className="w-5 h-5" />
              )}
              {selectedApp?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedApp && (
            <div className="space-y-4 text-sm">
              {/* Status badges */}
              <div className="flex gap-2">
                <Badge variant={selectedApp.is_active ? "default" : "secondary"}>
                  {selectedApp.is_active ? "Active" : "Inactive"}
                </Badge>
                {selectedApp.is_listed && <Badge variant="outline">Listed</Badge>}
                <Badge variant="outline">v{selectedApp.version}</Badge>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">App ID</span>
                  <div className="flex items-center gap-1 font-mono text-xs">
                    {selectedApp.id.slice(0, 12)}...
                    <CopyButton text={selectedApp.id} />
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Slug</span>
                  <div className="font-mono text-xs">{selectedApp.slug}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Creator</span>
                  <div>{selectedApp.creator_email}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Credits</span>
                  <div>{selectedApp.estimated_credits ?? "-"} CR</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Runs</span>
                  <div>{selectedApp.run_count}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <div>{new Date(selectedApp.created_at).toLocaleString()}</div>
                </div>
              </div>

              {/* Links */}
              <div className="flex flex-col gap-2 pt-2 border-t">
                <Link
                  to={selectedApp.workflow_project_id ? `/projects/${selectedApp.workflow_project_id}/workflows/${selectedApp.workflow_id}` : `/projects`}
                  target="_blank"
                  className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Workflow
                </Link>
                <a
                  href={`/app/${selectedApp.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open App ({selectedApp.slug})
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AppWindow, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { queryKeys } from "@/lib/query-keys"
import {
  readShowClientAppsFlag,
  writeShowClientAppsFlag,
} from "@/hooks/queries/use-client-apps-queries"
import {
  useAdminClientApps,
  useToggleClientAppMutation,
  type AdminClientApp,
} from "@/ee/hooks/queries/use-admin-queries"

// ── Workflow count ───────────────────────────────────────────────────

function WorkflowCountCell({ value }: { readonly value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">--</span>
  }
  return <span className="font-mono text-sm">{value.toLocaleString()}</span>
}

// ── Summary Cards ────────────────────────────────────────────────────

function SummaryCards({ apps }: { readonly apps: ReadonlyArray<AdminClientApp> }) {
  const listed = apps.filter((a) => a.workflowsListed)
  const hiddenWorkflows = apps
    .filter((a) => !a.workflowsListed)
    .reduce((sum, a) => sum + (a.workflowCount ?? 0), 0)
  const listedWorkflows = listed.reduce((sum, a) => sum + (a.workflowCount ?? 0), 0)

  const cards = [
    { label: "Registered Apps", value: apps.length, color: "text-foreground" },
    { label: "Workflows Listed", value: listed.length, color: "text-green-500" },
    { label: "Listed Workflows", value: listedWorkflows.toLocaleString(), color: "text-blue-500" },
    { label: "Hidden Workflows", value: hiddenWorkflows.toLocaleString(), color: "text-muted-foreground" },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="border rounded-lg p-4 bg-card">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── App Row ──────────────────────────────────────────────────────────

function ClientAppRow({
  app,
  onToggle,
  isToggling,
}: {
  readonly app: AdminClientApp
  readonly onToggle: (slug: string, listed: boolean) => void
  readonly isToggling: boolean
}) {
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{app.name}</span>
          <span className="text-xs text-muted-foreground font-mono">{app.slug}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <WorkflowCountCell value={app.workflowCount} />
      </td>
      <td className="py-3 px-4">
        <Badge
          variant="outline"
          className={
            app.workflowsListed
              ? "text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
              : "text-xs bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
          }
        >
          {app.workflowsListed ? "Visible" : "Hidden"}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <Switch
          checked={app.workflowsListed}
          onCheckedChange={(val) => onToggle(app.slug, val)}
          disabled={isToggling}
          aria-label={`List ${app.name} workflows in the dashboard`}
        />
      </td>
    </tr>
  )
}

// ── "Show in my lists" admin override ────────────────────────────────

/**
 * Admin-only escape hatch for the visibility rule. Client-app workflows and
 * projects (voice-changer-pro's conversions and its dedicated project) are
 * hidden from EVERYONE'S dashboard lists, admins included — that is the whole
 * point. This toggle lets an admin who needs to inspect them flip a local flag
 * that the dashboard's project + workflow list fetchers read; it is persisted in
 * localStorage (per-device, never leaves the browser) and off by default.
 */
function ShowInMyListsToggle() {
  const qc = useQueryClient()
  // Initialise to the SSR-safe default, then hydrate from localStorage on mount.
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    setEnabled(readShowClientAppsFlag())
  }, [])

  const handleToggle = (value: boolean) => {
    setEnabled(value)
    writeShowClientAppsFlag(value)
    // Refresh the dashboard lists + the ⌘K search so the change takes effect
    // without a reload. `projects.all` also covers the admin all-projects fetcher
    // (its key is prefixed by it), and `search.all` covers the ⌘K modal.
    qc.invalidateQueries({ queryKey: queryKeys.projects.all })
    qc.invalidateQueries({ queryKey: queryKeys.workflows.all })
    qc.invalidateQueries({ queryKey: queryKeys.search.all })
    toast.success(
      value
        ? "Client-app workflows and projects now shown in your lists"
        : "Client-app workflows and projects hidden from your lists",
    )
  }

  return (
    <div className="border rounded-lg p-4 bg-card mb-6 flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">Show client-app workflows in my lists</span>
        <span className="text-xs text-muted-foreground">
          Admin-only, this device. Reveals otherwise-hidden client-app rows (e.g. Voice Changer Pro
          conversions and its project) in your own workflow and project lists. Off by default.
        </span>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={handleToggle}
        aria-label="Show client-app workflows in my lists"
      />
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────

/**
 * Client Apps — the registry of apps built on the Nodaro SDK (`client_apps`),
 * and the one setting that matters about each: are its workflows first-class
 * objects the user can open in app.nodaro.ai, or private app storage?
 *
 * The workflow count next to each app is what makes the toggle legible: it is
 * exactly how many rows flipping the switch would add to, or remove from, users'
 * workflow lists.
 */
export default function AdminClientAppsPage() {
  const { data, isLoading } = useAdminClientApps()
  const apps = data ?? []
  const toggleMut = useToggleClientAppMutation()

  const handleToggle = async (slug: string, workflowsListed: boolean) => {
    try {
      await toggleMut.mutateAsync({ slug, workflowsListed })
      toast.success(
        `${slug} workflows ${workflowsListed ? "now listed" : "now hidden"} in the dashboard`,
      )
    } catch {
      toast.error("Failed to update client app")
    }
  }

  if (isLoading && apps.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <AppWindow className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Client Apps</h1>
        <span className="text-xs text-muted-foreground ml-2">
          {apps.length} registered
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Apps built on the Nodaro SDK. <strong>Workflows listed</strong> decides whether an app&apos;s
        workflows appear in its users&apos; &ldquo;My Workflows&rdquo; list — on for apps whose
        workflows are first-class objects the user opens here (Studio), off for apps that use
        workflows as private storage (Voice Changer Pro, one row per conversion). Workflows created
        in app.nodaro.ai itself are always listed, and an app that is not registered here is
        hidden.
      </p>

      <ShowInMyListsToggle />

      <SummaryCards apps={apps} />

      {apps.length === 0 && (
        <div className="border rounded-lg p-8 bg-card text-center">
          <AppWindow className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No client apps registered.</p>
        </div>
      )}

      {/* Registry table */}
      {apps.length > 0 && (
        <div className="border rounded-lg bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                <th className="text-left py-2 px-4 font-medium">App</th>
                <th className="text-left py-2 px-4 font-medium">Workflows</th>
                <th className="text-left py-2 px-4 font-medium">In workflow list</th>
                <th className="text-left py-2 px-4 font-medium">Workflows listed</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <ClientAppRow
                  key={app.slug}
                  app={app}
                  onToggle={handleToggle}
                  isToggling={toggleMut.isPending && toggleMut.variables?.slug === app.slug}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { AppWindow, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
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

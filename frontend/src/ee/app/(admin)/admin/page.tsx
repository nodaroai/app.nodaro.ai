import { Loader2, Users, FolderOpen, GitBranch, Briefcase, Coins, Mail, Sparkles } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useAdminStats } from "@/ee/hooks/queries/use-admin-queries"
import { hasCredits } from "@/lib/edition"
import { shareOfUsers } from "./share-of-users"

interface StatCard {
  readonly label: string
  /** `null`: not known on this database yet (shown as an em dash, never 0). */
  readonly value: number | null
  readonly icon: LucideIcon
  /** The share of all users, under the count. */
  readonly ofUsers?: boolean
}

export default function AdminDashboard() {
  const { data: stats, isLoading: loading } = useAdminStats()

  if (loading && !stats) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!stats) {
    return <div className="p-6 text-muted-foreground">Failed to load stats.</div>
  }

  const cards: StatCard[] = [
    { label: "Total Users", value: stats.totalUsers, icon: Users },
    // Marketing-email consent is asked for on Cloud only; elsewhere the count is always 0.
    ...(hasCredits() ? [{ label: "Accept Email", value: stats.usersAcceptingEmail, icon: Mail, ofUsers: true }] : []),
    { label: "Made a Generation", value: stats.usersWithGeneration, icon: Sparkles, ofUsers: true },
    { label: "Total Projects", value: stats.totalProjects, icon: FolderOpen },
    { label: "Total Workflows", value: stats.totalWorkflows, icon: GitBranch },
    { label: "Total Jobs", value: stats.totalJobs, icon: Briefcase },
    { label: "Credits Used", value: stats.totalCreditsUsed, icon: Coins },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="border rounded-lg p-4 bg-card flex items-center gap-3"
          >
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
              <card.icon className="h-5 w-5 text-primary-ink" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold">{card.value === null ? "—" : card.value.toLocaleString()}</p>
              {card.ofUsers && shareOfUsers(card.value, stats.totalUsers) && (
                <p className="text-xs text-muted-foreground">{shareOfUsers(card.value, stats.totalUsers)}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(stats.jobsByStatus).length > 0 && (
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium mb-3">Jobs by Status</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.jobsByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 text-sm">
                <span className="capitalize text-muted-foreground">{status}:</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

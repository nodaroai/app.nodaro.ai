import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Loader2, RefreshCw, Server } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

/**
 * Hosted deployments — the billing status of each dedicated deployment Nodaro
 * runs for a customer, read from that deployment's own billing API with a
 * READ-ONLY integration key (`HOSTED_DEPLOYMENTS`, server-side). Everything
 * here is read-only: changing a deployment's top-up or allowances is its
 * billing account's job, on its own `/billing-admin`.
 *
 * Figures are RAW Nodaro credits — the deployment's real pool, not the unit its
 * users see.
 */

interface AutoRechargeStatus {
  enabled: boolean
  active: boolean
  thresholdCredits: number | null
  amountUsd: number | null
  failureCount: number
  lastAttemptAt: string | null
}

interface DeploymentBalance {
  balanceCredits: number | null
  burn?: { periodStart: string; credits: number | null; generations: number | null; capped: boolean }
  lowBalance: boolean
  threshold: number | null
  /** Absent on a deployment whose platform predates the field. */
  autoRecharge?: AutoRechargeStatus | null
}

interface DeploymentRow {
  name: string
  host: string
  ok: boolean
  balance?: DeploymentBalance
  status?: number
  error?: "unreachable" | "rejected" | "bad_response"
}

interface HostedDeploymentsResponse {
  data: DeploymentRow[]
  invalid: Array<{ index: number; name: string | null; reason: string }>
  checkedAt: string
}

async function fetchHostedDeployments(refresh: boolean): Promise<HostedDeploymentsResponse> {
  const res = await fetch(`/v1/admin/hosted-deployments${refresh ? "?refresh=1" : ""}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw new Error("Failed to load hosted deployments")
  return res.json()
}

const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString())
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—")

const ERROR_TEXT: Record<NonNullable<DeploymentRow["error"]>, string> = {
  unreachable: "Unreachable",
  rejected: "Refused the key",
  bad_response: "Unexpected answer",
}

const INVALID_TEXT: Record<string, string> = {
  key_not_read_only: "the key is not read-only (ndr_bill_ro_…) — refused, never called",
  url_not_https: "the URL is not https — refused",
  invalid_entry: "the entry is malformed (needs name, url, key)",
}

export default function HostedDeploymentsPage() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.hostedDeployments(),
    queryFn: () => fetchHostedDeployments(false),
    enabled: hasAdmin(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  async function refresh() {
    setRefreshing(true)
    try {
      qc.setQueryData(queryKeys.admin.hostedDeployments(), await fetchHostedDeployments(true))
    } finally {
      setRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (isError || !data) {
    return <div className="p-6 text-muted-foreground">Failed to load hosted deployments.</div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">Hosted Deployments</h1>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 me-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Read-only billing status of each dedicated deployment, in raw Nodaro credits. Checked {when(data.checkedAt)}.
      </p>

      {data.invalid.length > 0 && (
        <div data-testid="hosted-invalid" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          {data.invalid.map((i) => (
            <div key={i.index}>
              Entry {i.index + 1}
              {i.name ? ` (${i.name})` : ""}: {INVALID_TEXT[i.reason] ?? i.reason}
            </div>
          ))}
        </div>
      )}

      {data.data.length === 0 && data.invalid.length === 0 && (
        <div className="rounded-lg border bg-card p-6 text-muted-foreground">
          No hosted deployments configured. Set <code>HOSTED_DEPLOYMENTS</code> to a JSON list of{" "}
          <code>{"{ name, url, key }"}</code> — each key a read-only billing integration key minted by that
          deployment's billing account.
        </div>
      )}

      <div className="space-y-4">
        {data.data.map((d) => (
          <DeploymentCard key={`${d.name}-${d.host}`} d={d} />
        ))}
      </div>
    </div>
  )
}

function DeploymentCard({ d }: { d: DeploymentRow }) {
  const b = d.balance
  const ar = b?.autoRecharge ?? null
  return (
    <section data-testid={`hosted-${d.name}`} className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
          <Server className="h-5 w-5 text-primary-ink" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold">{d.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{d.host}</p>
        </div>
        {!d.ok && (
          <span className="ms-auto flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {d.error ? ERROR_TEXT[d.error] : "Error"}
            {d.status ? ` (${d.status})` : ""}
          </span>
        )}
        {d.ok && b?.lowBalance && (
          <span className="ms-auto flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Low balance
          </span>
        )}
      </div>

      {d.ok && b && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Fact label="Pool balance" value={num(b.balanceCredits)} />
          <Fact label="Spent this month" value={num(b.burn?.credits)} />
          <Fact label="Generations this month" value={num(b.burn?.generations)} />
          <Fact label="Low-balance threshold" value={num(b.threshold)} />
          <Fact
            label="Auto top-up"
            value={ar === null ? "—" : ar.active ? "Active" : ar.enabled ? "On, not active" : "Off"}
          />
          <Fact
            label="Top-up rule"
            value={ar && ar.thresholdCredits != null && ar.amountUsd != null ? `< ${num(ar.thresholdCredits)} → $${ar.amountUsd}` : "—"}
          />
          <Fact label="Failed charges" value={ar ? String(ar.failureCount) : "—"} />
          <Fact label="Last charge attempt" value={when(ar?.lastAttemptAt)} />
        </dl>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

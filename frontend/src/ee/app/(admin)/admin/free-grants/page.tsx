import { useCallback, useEffect, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { hasAdmin } from "@/lib/edition"
import { getAuthHeaders } from "@/lib/api"

/**
 * Free-grant review: accounts whose signup grant was withheld, with the rules
 * that fired, and a one-click restore. Restore is a platform-operator action
 * server-side (it mints credits); the page just shows the button and reports
 * the refusal.
 */

interface FreeGrantRow {
  userId: string
  email: string | null
  fullName: string | null
  createdAt: string
  subscriptionCredits: number
  state: "withheld" | "granted" | "unclaimed"
  reasons: string[]
  decidedAt: string | null
}

const REASON_LABELS: Record<string, string> = {
  email_only_provider: "Email/password only (no Google)",
  browser_match: "Same browser as another account",
  device_ip_match: "Same device + network as another account",
  device_cluster: "Device signature shared by several accounts",
  ip_velocity: "Signup burst from one network",
}

const LIMIT = 50

async function fetchWithheld(offset: number): Promise<{ data: FreeGrantRow[]; total: number }> {
  const res = await fetch(`/v1/admin/free-grants?state=withheld&limit=${LIMIT}&offset=${offset}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) throw new Error("Failed to load withheld grants")
  return (await res.json()) as { data: FreeGrantRow[]; total: number }
}

async function restoreGrant(userId: string): Promise<void> {
  const res = await fetch(`/v1/admin/free-grants/${encodeURIComponent(userId)}/activate`, {
    method: "POST",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? "Failed to restore the grant")
  }
}

export default function AdminFreeGrantsPage() {
  const [rows, setRows] = useState<FreeGrantRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(() => {
    fetchWithheld(offset)
      .then((r) => {
        setRows(r.data)
        setTotal(r.total)
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to load")
        setRows([])
      })
  }, [offset])

  useEffect(() => {
    reload()
  }, [reload])

  if (!hasAdmin()) return null

  async function handleRestore(row: FreeGrantRow) {
    setBusy(row.userId)
    try {
      await restoreGrant(row.userId)
      toast.success(`Grant restored for ${row.email ?? row.userId}`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Free Grants</h1>
        <p className="text-sm text-muted-foreground">
          Accounts whose free signup credits were withheld. Restore mints the grant.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Withheld {rows ? `(${total})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Nothing withheld.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Account</th>
                    <th className="py-2 pr-4 font-medium">Signed up</th>
                    <th className="py-2 pr-4 font-medium">Why</th>
                    <th className="py-2 pr-4 font-medium text-right">Balance</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.userId} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.email ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.fullName ?? row.userId}</div>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {row.reasons.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            row.reasons.map((r) => (
                              <Badge key={r} variant="outline" title={r}>
                                {REASON_LABELS[r] ?? r}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">{row.subscriptionCredits}</td>
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === row.userId}
                          onClick={() => handleRestore(row)}
                        >
                          {busy === row.userId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          )}
                          Restore grant
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > LIMIT && (
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
              <Button size="sm" variant="ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

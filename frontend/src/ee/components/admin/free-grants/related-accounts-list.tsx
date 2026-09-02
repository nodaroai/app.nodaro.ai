import { Badge } from "@/components/ui/badge"
import { MATCH_LABELS, type RelatedAccount, type RelatedSignal } from "./types"

/**
 * Presentational: the signup signature this account claimed from, and every
 * other account that shares a piece of it. Only key PREFIXES ever reach the
 * browser — the full hash is a lookup token.
 */
export function RelatedAccountsList({
  signal,
  related,
  truncated = false,
}: {
  signal: RelatedSignal | null
  related: RelatedAccount[]
  truncated?: boolean
}) {
  if (!signal) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No signup signal recorded — this account predates the gate or claimed keyless.
      </p>
    )
  }

  const prefixes: Array<{ label: string; value: string }> = []
  if (signal.deviceKeyPrefix) prefixes.push({ label: "Device", value: signal.deviceKeyPrefix })
  if (signal.browserKeyPrefix) prefixes.push({ label: "Browser", value: signal.browserKeyPrefix })
  if (signal.ipHashPrefix) prefixes.push({ label: "Network", value: signal.ipHashPrefix })

  return (
    <div className="py-2 space-y-2">
      {prefixes.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {prefixes.map((p) => (
            <span key={p.label}>
              {p.label} <span className="font-mono">{p.value}</span>
            </span>
          ))}
        </div>
      )}

      {related.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No other account shares this machine or network.
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {related.map((account) => (
              <tr key={account.userId} className="border-b last:border-0 align-top">
                <td className="py-1.5 pr-4">
                  <div>{account.email ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {account.fullName ?? account.userId}
                  </div>
                </td>
                <td className="py-1.5 pr-4">
                  {account.state ? <Badge>{account.state}</Badge> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-1.5 pr-4 text-right font-mono">{account.subscriptionCredits}</td>
                <td className="py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {account.matches.map((m) => (
                      <Badge key={m} variant="outline">
                        {MATCH_LABELS[m]}
                      </Badge>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first {related.length} — more accounts share these signals.
        </p>
      )}
    </div>
  )
}

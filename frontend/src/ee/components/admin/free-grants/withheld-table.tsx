import { useCallback, useEffect, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { fetchRelated, fetchWithheld, restoreGrant } from "./api"
import { RelatedAccountsList } from "./related-accounts-list"
import { PAGE_LIMIT, REASON_LABELS, type FreeGrantRow, type RelatedResponse } from "./types"

type RelatedData = RelatedResponse["data"]

/**
 * Accounts whose signup grant was withheld, with the rules that fired and a
 * one-click restore. Restore is a platform-operator action server-side (it
 * mints credits); this just shows the button and reports the refusal.
 *
 * Each row can expand to the accounts that share its machine or network. That
 * fetch is lazy and cached per user — toggling twice must not re-hit the API.
 */
export function WithheldTable() {
  const [rows, setRows] = useState<FreeGrantRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [related, setRelated] = useState<Record<string, RelatedData>>({})
  const [relatedBusy, setRelatedBusy] = useState<string[]>([])

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

  async function toggleRelated(userId: string) {
    setExpanded((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]))
    if (related[userId] || relatedBusy.includes(userId)) return
    setRelatedBusy((prev) => [...prev, userId])
    try {
      const data = await fetchRelated(userId)
      setRelated((prev) => ({ ...prev, [userId]: data }))
    } catch (err) {
      // Nothing cached, so leaving the row open would strand it on "Loading…"
      // forever. Collapse it and let the toast be the signal; toggling retries.
      setExpanded((prev) => prev.filter((id) => id !== userId))
      toast.error(err instanceof Error ? err.message : "Failed to load related accounts")
    } finally {
      setRelatedBusy((prev) => prev.filter((id) => id !== userId))
    }
  }

  return (
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
                  <th className="py-2 pr-4 font-medium" />
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <FragmentRow
                    key={row.userId}
                    row={row}
                    busy={busy === row.userId}
                    expanded={expanded.includes(row.userId)}
                    loadingRelated={relatedBusy.includes(row.userId)}
                    related={related[row.userId]}
                    onRestore={() => handleRestore(row)}
                    onToggleRelated={() => toggleRelated(row.userId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_LIMIT && (
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button
              size="sm"
              variant="ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_LIMIT, total)} of {total}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={offset + PAGE_LIMIT >= total}
              onClick={() => setOffset(offset + PAGE_LIMIT)}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FragmentRow({
  row,
  busy,
  expanded,
  loadingRelated,
  related,
  onRestore,
  onToggleRelated,
}: {
  row: FreeGrantRow
  busy: boolean
  expanded: boolean
  loadingRelated: boolean
  related: RelatedData | undefined
  onRestore: () => void
  onToggleRelated: () => void
}) {
  return (
    <>
      <tr className="border-b last:border-0 align-top">
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
        <td className="py-2 pr-4 text-right">
          <Button size="sm" variant="ghost" onClick={onToggleRelated}>
            Related
          </Button>
        </td>
        <td className="py-2 text-right">
          <Button size="sm" variant="outline" disabled={busy} onClick={onRestore}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Restore grant
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0 bg-muted/30">
          <td colSpan={6} className="px-2">
            {related ? (
              <RelatedAccountsList signal={related.signal} related={related.related} truncated={related.truncated} />
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                {loadingRelated && <Loader2 className="h-4 w-4 animate-spin" />} Loading…
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

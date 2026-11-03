import { useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useFinishRestrictionBytes,
  useLiftCaseRestriction,
  useNameComplaintUser,
  useRematchComplaint,
  useRestrictFromComplaint,
  type CaseCounterNotice,
  type CaseRestriction,
  type ComplaintCase,
  type MatchedAsset,
} from "@/ee/hooks/queries/use-admin-complaints-queries"
import { formatWhen, historyLabel, openableAddress } from "./complaint-labels"
import { restrictionBytesSummary } from "./restriction-bytes"

const adminUserLink = (userId: string) => `/admin/users?user=${encodeURIComponent(userId)}`

/**
 * What the case's links matched in our records — the files (a restricted one
 * included: this is the one screen that shows it), the import confirmations
 * made for those links, the accounts behind them with their history — and
 * the restrictions the case led to. A file is restricted from here with a
 * reason; a restriction is lifted from here too. Matching again only adds:
 * a file the case matched stays on it.
 */
export function CaseMatches({ complaint: c }: { readonly complaint: ComplaintCase }) {
  const rematch = useRematchComplaint()

  async function runRematch() {
    try {
      await rematch.mutateAsync({ id: c.id })
      toast.success("Links matched again")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to match the complaint again")
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="case-matches-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="case-matches-heading" className="text-sm font-semibold">What the links matched</h2>
        <Button variant="outline" size="sm" onClick={runRematch} disabled={rematch.isPending || c.reportedUrls.length === 0}>
          {rematch.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />}
          Match again
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Files ({c.matchedAssets.length})</h3>
        {c.missingAssetIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {c.missingAssetIds.length} matched file{c.missingAssetIds.length === 1 ? " no longer exists" : "s no longer exist"}: deleted before the case held {c.missingAssetIds.length === 1 ? "it" : "them"}.
          </p>
        )}
        {c.matchedAssets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stored file matched.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {c.matchedAssets.map((a) => (
              <MatchedFile key={a.id} complaintId={c.id} asset={a} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Imports confirmed for these links ({c.matchedConfirmations.length})</h3>
        {c.matchedConfirmations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No import confirmation matched.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {c.matchedConfirmations.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="break-all font-mono text-xs">{k.sourceUrl}</span>
                <span className="text-xs text-muted-foreground">{k.kind}{k.lane ? ` · ${k.lane}` : ""} · {formatWhen(k.createdAt)}</span>
                {k.userId && <Link to={adminUserLink(k.userId)} className="text-xs underline underline-offset-2">account</Link>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <CaseAccounts complaint={c} />
      <CaseRestrictions complaint={c} />
    </section>
  )
}

function MatchedFile({ complaintId, asset: a }: { readonly complaintId: string; readonly asset: MatchedAsset }) {
  const restrict = useRestrictFromComplaint()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const name = a.filename ?? a.r2Key ?? a.id

  function close() {
    setOpen(false)
    setReason("")
  }

  async function submit() {
    try {
      await restrict.mutateAsync({ id: complaintId, assetId: a.id, reason: reason.trim() })
      close()
      toast.success("File restricted")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restrict the content")
    }
  }

  return (
    <li className="space-y-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{a.type ?? "file"} · stored {formatWhen(a.createdAt)}</span>
        {a.userId && <Link to={adminUserLink(a.userId)} className="text-xs underline underline-offset-2">owner</Link>}
        {openableAddress(a.r2Url, a.restrictedAt) && (
          <a href={a.r2Url} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-2">open</a>
        )}
        {a.restrictedAt ? (
          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">restricted {formatWhen(a.restrictedAt)}</span>
        ) : (
          !open && <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Restrict ${name}`}>Restrict…</Button>
        )}
      </div>
      {open && !a.restrictedAt && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim() && !restrict.isPending) void submit()
          }}
        >
          <Input
            className="max-w-md"
            aria-label={`Why ${name} is restricted`}
            placeholder="Reason (kept on the restriction's record)"
            value={reason}
            maxLength={4000}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" size="sm" variant="destructive" disabled={!reason.trim() || restrict.isPending}>
            {restrict.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Restrict the file
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={close} disabled={restrict.isPending}>Cancel</Button>
        </form>
      )}
    </li>
  )
}

function CaseAccounts({ complaint: c }: { readonly complaint: ComplaintCase }) {
  const name = useNameComplaintUser()
  // The row whose move is in flight: only its button shows it.
  const pendingFor = name.isPending ? name.variables?.userId ?? null : undefined

  async function setAccount(userId: string | null) {
    try {
      await name.mutateAsync({ id: c.id, userId, seen: c.updatedAt })
      toast.success(userId ? "Account named on the case" : "Account removed from the case")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to name the account")
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Accounts ({c.matchedUsers.length + c.moreAccounts})</h3>
      {c.matchedUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No account matched.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {c.matchedUsers.map((u) => {
            const named = c.userId === u.id
            const busy = pendingFor !== undefined && (pendingFor === u.id || (named && pendingFor === null))
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <Link to={adminUserLink(u.id)} className="underline underline-offset-2">{u.email ?? u.id}</Link>
                <span className="text-xs text-muted-foreground">
                  {historyLabel(u.otherCases)}
                  {` · ${u.activeRestrictions} standing restriction${u.activeRestrictions === 1 ? "" : "s"}`}
                </span>
                {named ? (
                  <>
                    <span className="text-xs font-medium">the case's account</span>
                    <Button size="sm" variant="ghost" onClick={() => setAccount(null)} disabled={name.isPending}>
                      {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      Unname
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setAccount(u.id)} disabled={name.isPending}>
                    {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Name as the case's account
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {c.historyTruncated && (
        <p className="text-xs text-muted-foreground">The other-case counts are read from the most recent cases only, and may be low.</p>
      )}
      {c.moreAccounts > 0 && (
        <p className="text-xs text-muted-foreground">
          And {c.moreAccounts} more account{c.moreAccounts === 1 ? "" : "s"}, not shown here: the links matched more accounts than this page reads.
        </p>
      )}
    </div>
  )
}

/** Where the restriction's files are, and — when finishing them now can change something — the button that does. */
function BytesLine({ restriction, onFinish, finishing, busy }: { readonly restriction: CaseRestriction; readonly onFinish: () => void; readonly finishing: boolean; readonly busy: boolean }) {
  const summary = restrictionBytesSummary(restriction)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={summary.settled ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}>{summary.text}</span>
      {summary.actionable && (
        <Button size="sm" variant="outline" onClick={onFinish} disabled={busy}>
          {finishing && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Finish now
        </Button>
      )}
    </div>
  )
}

/**
 * What lifting a restriction here does to its counter-notice: a court action
 * on it holds the content on every route (the server refuses the lift), and
 * a lift otherwise restores the content now and settles the counter-notice,
 * outside its own steps (migration 587).
 */
function LiftWarning({ notice: n }: { readonly notice: CaseCounterNotice | undefined }) {
  if (!n || n.restoredAt) return null
  const text =
    n.courtActionAt && !n.courtActionEndedAt
      ? `A court action recorded on counter-notice ${n.reference} holds this content: record that the court action ended first.`
      : `Counter-notice ${n.reference} answers this restriction: lifting it here restores the content now, outside the counter-notice's steps, and settles it.`
  return <p className="text-xs text-amber-700 dark:text-amber-300">{text}</p>
}

function CaseRestrictions({ complaint: c }: { readonly complaint: ComplaintCase }) {
  const lift = useLiftCaseRestriction()
  const finish = useFinishRestrictionBytes()
  const [lifting, setLifting] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const noticeOf = new Map(c.counterNotices.map((n) => [n.restrictionId, n]))

  function cancelLift() {
    setLifting(null)
    setReason("")
  }

  async function finishBytes(restrictionId: string) {
    try {
      await finish.mutateAsync({ restrictionId })
      toast.success("Files finished")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to finish the restriction's files")
    }
  }

  async function submit(restrictionId: string) {
    try {
      await lift.mutateAsync({ restrictionId, reason: reason.trim() || null })
      cancelLift()
      toast.success("Restriction lifted")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to lift the restriction")
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Restrictions from this case ({c.restrictions.length})</h3>
      {c.restrictions.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {c.restrictions.map((r) => {
            const label = r.r2Keys[0] ?? r.assetId ?? r.jobId ?? r.id
            const finishingThis = finish.isPending && finish.variables?.restrictionId === r.id
            const liftingThis = lift.isPending && lift.variables?.restrictionId === r.id
            return (
              <li key={r.id} className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs">{label}</span>
                  <span className="text-xs text-muted-foreground">
                    restricted {formatWhen(r.restrictedAt)}{r.liftedAt ? ` · lifted ${formatWhen(r.liftedAt)}` : ""}
                  </span>
                  {!r.liftedAt && lifting !== r.id && (
                    <Button size="sm" variant="outline" onClick={() => setLifting(r.id)} aria-label={`Lift the restriction of ${label}`}>Lift…</Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{r.reason}{r.liftReason ? ` — lifted: ${r.liftReason}` : ""}</p>
                <BytesLine restriction={r} onFinish={() => finishBytes(r.id)} finishing={finishingThis} busy={finishingThis || liftingThis} />
                {lifting === r.id && <LiftWarning notice={noticeOf.get(r.id)} />}
                {lifting === r.id && (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!lift.isPending) void submit(r.id)
                    }}
                  >
                    <Input
                      className="max-w-md"
                      aria-label={`Why the restriction of ${label} is lifted`}
                      placeholder="Why (a mistake, a complaint withdrawn)"
                      value={reason}
                      maxLength={4000}
                      autoFocus
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button type="submit" size="sm" disabled={lift.isPending}>
                      {liftingThis && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      Lift the restriction
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={cancelLift} disabled={liftingThis}>Cancel</Button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

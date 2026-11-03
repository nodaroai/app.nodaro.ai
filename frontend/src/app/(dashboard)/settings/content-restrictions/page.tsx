import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { formatDate } from "@/lib/i18n/format"
import { useAuth } from "@/hooks/use-auth"
import type { MyCounterNotice, MyRestriction } from "@/lib/api"
import { useMyRestrictions } from "@/hooks/queries/use-my-restrictions"
import { CounterNoticeForm } from "./counter-notice-form"

/** A window's day as written (`YYYY-MM-DD`, a New York calendar date): read in UTC, so no time zone moves it a day. */
const calendarDate = (day: string) => formatDate(`${day}T00:00:00Z`, { timeZone: "UTC" })

/**
 * Settings → Content restrictions: content of mine a complaint led to
 * restricting (a restricted file reads as gone everywhere else), why, the
 * complaint's reference, and the counter-notification that answers it, with
 * where it stands. Never the complainant's identity. Masked from session
 * recordings.
 */
export default function ContentRestrictionsPage() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const { user } = useAuth()
  const { data: restrictions, isLoading, isError } = useMyRestrictions()
  const [answering, setAnswering] = useState<string | null>(null)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8" data-clarity-mask="true">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors" aria-label={t("common.back")}>
          <ArrowLeft className={cn("h-5 w-5", isRtl && "rotate-180")} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("restrictions.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("restrictions.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-600">{t("apiErr.listMyRestrictions")}</p>
      ) : (restrictions ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
          <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("restrictions.empty")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(restrictions ?? []).map((r) => (
            <RestrictionRow
              key={r.id}
              restriction={r}
              answering={answering === r.id}
              onAnswer={() => setAnswering(r.id)}
              onDone={() => setAnswering(null)}
              defaultEmail={user?.email ?? ""}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Where the counter-notification sent for a restriction stands: one line for each outcome, the window while it waits. */
function CounterNoticeStatus({ notice }: { readonly notice: MyCounterNotice }) {
  const t = useT()
  return (
    <div className="mt-3 space-y-1 rounded-md bg-muted/40 p-3 text-sm">
      <p className="font-medium">{t("restrictions.sentTitle", { reference: notice.reference, date: formatDate(notice.receivedAt) })}</p>
      {notice.restored ? (
        <p>{t("restrictions.restored")}</p>
      ) : notice.declined ? (
        <p className="whitespace-pre-wrap">{t("restrictions.declined", { reason: notice.declinedReason ?? "" })}</p>
      ) : notice.courtAction && notice.courtActionEnded ? (
        <p>{t("restrictions.courtActionEnded")}</p>
      ) : notice.courtAction ? (
        <p>{t("restrictions.courtAction")}</p>
      ) : (
        <>
          <p>{notice.forwarded ? t("restrictions.forwarded") : t("restrictions.notForwarded")}</p>
          <p>{t("restrictions.window", { opens: calendarDate(notice.opensOn), closes: calendarDate(notice.closesOn) })}</p>
        </>
      )}
    </div>
  )
}

function RestrictionRow({
  restriction: r,
  answering,
  onAnswer,
  onDone,
  defaultEmail,
}: {
  readonly restriction: MyRestriction
  readonly answering: boolean
  readonly onAnswer: () => void
  readonly onDone: () => void
  readonly defaultEmail: string
}) {
  const t = useT()
  const itemName = r.item.name ?? (r.item.kind === "file" ? t("restrictions.file") : t("restrictions.result"))

  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-sm break-all">{itemName}</span>
        <span className="text-xs text-muted-foreground" dir="ltr">{t("restrictions.case", { reference: r.caseReference })}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{t("restrictions.restrictedOn", { date: formatDate(r.restrictedAt) })}</span>
        {r.liftedAt && <span>{t("restrictions.liftedOn", { date: formatDate(r.liftedAt) })}</span>}
      </div>
      <p className="mt-2 text-sm">{r.caseKind === "copyright" ? t("restrictions.whyCopyright") : t("restrictions.whyOther")}</p>

      {r.counterNotice ? (
        <CounterNoticeStatus notice={r.counterNotice} />
      ) : r.liftedAt ? null : r.caseKind !== "copyright" ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("restrictions.notCopyright")}</p>
      ) : !r.canSendCounterNotice ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("restrictions.caseClosed")}</p>
      ) : answering ? (
        <CounterNoticeForm restriction={r} defaultEmail={defaultEmail} onDone={onDone} />
      ) : (
        <Button className="mt-3" variant="outline" size="sm" onClick={onAnswer}>{t("restrictions.send")}</Button>
      )}
    </li>
  )
}

import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"
import type { MyAccountMeasure, MyAccountStanding } from "@/lib/api"
import { hasAccountStanding } from "@/hooks/queries/use-my-restrictions"

/** What the administrator told me about a measure, as they wrote it. */
function Reason({ text }: { readonly text: string }) {
  const t = useT()
  return (
    <p dir="auto" className="whitespace-pre-wrap break-words text-muted-foreground">
      {t("restrictions.account.reason", { reason: text })}
    </p>
  )
}

/** What a measure in force says to me: the account closed or suspended (until when), importing links blocked (until when). */
function inForceText(m: MyAccountMeasure, t: ReturnType<typeof useT>): string {
  const until = m.endsAt ? formatDate(m.endsAt, { timeZone: "UTC" }) : null
  if (m.kind === "closed") return t("restrictions.account.closed")
  if (m.kind === "suspended") return t("restrictions.account.suspendedUntil", { date: until ?? "" })
  return until ? t("restrictions.account.importsBlockedUntil", { date: until }) : t("restrictions.account.importsBlocked")
}

/**
 * A measure in force: importing links blocked (until when), the account
 * suspended (until when), or the account closed. The end is the UTC date, as
 * a refused import names it, so the two never name different days.
 */
function MeasureInForce({ measure: m }: { readonly measure: MyAccountMeasure }) {
  const t = useT()
  const text = inForceText(m, t)
  return (
    <div className="text-sm">
      <p className="font-medium">{text}</p>
      <Reason text={m.reason} />
    </div>
  )
}

/**
 * Where my account stands under the repeat-infringer policy: the measures in
 * force (importing links blocked, and until when; the account suspended, and
 * until when; the account closed), each
 * with what the administrator told me, and the warnings and infringements
 * recorded within the policy's window, an infringement by its complaint's
 * reference. Never an administrator's note. Nothing when there is nothing
 * on the account.
 */
export function AccountStandingBox({ standing }: { readonly standing: MyAccountStanding | undefined }) {
  const t = useT()
  if (!standing || !hasAccountStanding(standing)) return null
  return (
    <section className="mb-6 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" aria-labelledby="account-standing-heading">
      <h2 id="account-standing-heading" className="text-base font-semibold">{t("restrictions.account.title")}</h2>
      {standing.inForce.map((m) => (
        <MeasureInForce key={`${m.kind}-${m.appliedAt}`} measure={m} />
      ))}
      {standing.warnings.map((m) => (
        <div key={`warning-${m.appliedAt}`} className="text-sm">
          <p className="font-medium">{t("restrictions.account.warning", { date: formatDate(m.appliedAt) })}</p>
          <Reason text={m.reason} />
        </div>
      ))}
      {standing.infringements.length > 0 && (
        <div className="text-sm">
          <p>{t("restrictions.account.infringements", { count: String(standing.infringements.length) })}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {standing.infringements.map((i) => (
              <li key={`${i.caseReference ?? "case"}-${i.recordedAt}`}>
                {i.caseReference && <span dir="ltr">{t("restrictions.case", { reference: i.caseReference })}</span>}
                {i.caseReference ? " · " : ""}
                {formatDate(i.recordedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("restrictions.account.window", { months: String(standing.windowMonths) })} {t("restrictions.account.policy")}
      </p>
    </section>
  )
}

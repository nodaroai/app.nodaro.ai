import type { CSSProperties } from "react"
import { Loader2 } from "lucide-react"
import type { TransactionRecord } from "@/lib/api"
import { useT, type MessageKey, type TFunction } from "@/lib/i18n"
import {
  MONO_FONT,
  PINK,
  formatCredits,
  formatShortDate,
  sectionCard,
  sectionTitle,
} from "./billing-styles"

interface CreditActivityProps {
  transactions: readonly TransactionRecord[]
  loading: boolean
}

const GRID_COLUMNS = "1.4fr 1fr 0.9fr 0.7fr"
const MAX_ROWS = 10

type ActivitySource = "Subscription" | "Top-up" | "Refund"

interface ActivityRow {
  id: string
  description: string
  source: ActivitySource
  date: string
  /** Signed credit amount, e.g. "+3,300" / "−990" (U+2212 minus). */
  amount: string
  positive: boolean
  /** Stripe hosted receipt link (view/download); null for older rows. */
  receiptUrl: string | null
  /** Dollar amount of the charge/refund, e.g. "$5.00"; null when 0/absent. */
  usd: string | null
}

const TAG_COLORS: Record<ActivitySource, { color: string; background: string }> = {
  Subscription: { color: "var(--blg-tag-sub-text)", background: "var(--blg-tag-sub-bg)" },
  "Top-up": { color: "var(--blg-tag-top-text)", background: "var(--blg-tag-top-bg)" },
  Refund: { color: "var(--blg-tag-neutral-text)", background: "var(--blg-tag-neutral-bg)" },
}

const SOURCE_LABEL_KEYS: Record<ActivitySource, MessageKey> = {
  Subscription: "billing.sourceSubscription",
  "Top-up": "billing.sourceTopup",
  Refund: "billing.sourceRefund",
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toActivityRow(tx: TransactionRecord, t: TFunction): ActivityRow {
  // The declared union is "subscription" | "topup", but refund rows can come
  // through the same feed — widen before comparing so tsc allows the check.
  const type: string = tx.type
  const isRefund = type === "refund"
  const source: ActivitySource =
    type === "subscription" ? "Subscription" : isRefund ? "Refund" : "Top-up"
  const description =
    type === "subscription"
      ? t("billing.tierPlan", { tier: capitalize(tx.tier ?? t("billing.sourceSubscription")) })
      : isRefund
        ? t("billing.creditRefund")
        : t("billing.creditTopup")
  const credits = Math.abs(tx.credits_granted)
  const negative = isRefund || tx.credits_granted < 0
  return {
    id: tx.id,
    description,
    source,
    date: formatShortDate(tx.created_at),
    amount: `${negative ? "−" : "+"}${formatCredits(credits)}`,
    positive: !negative,
    receiptUrl: tx.receipt_url ?? null,
    usd: tx.amount_usd
      ? `${negative ? "\u2212" : ""}$${Math.abs(tx.amount_usd).toFixed(2)}`
      : null,
  }
}

const headerCell: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  gap: 12,
  padding: "0 4px 10px",
  borderBottom: "1px solid var(--blg-border-2)",
  fontSize: 11,
  letterSpacing: "0.1em",
  color: "var(--blg-t3-head)",
  fontWeight: 700,
}

const bodyRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_COLUMNS,
  gap: 12,
  padding: "14px 4px",
  borderBottom: "1px solid var(--blg-border-soft)",
  alignItems: "center",
  fontSize: 13.5,
}

export function CreditActivity({ transactions, loading }: CreditActivityProps) {
  const t = useT()
  const rows = [...transactions]
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, MAX_ROWS)
    .map((record) => toActivityRow(record, t))

  return (
    <section style={sectionCard}>
      <h2 style={{ ...sectionTitle, margin: "0 0 18px" }}>{t("billing.creditActivity")}</h2>
      <div style={headerCell}>
        <span>{t("billing.colDescription")}</span>
        <span>{t("billing.colSource")}</span>
        <span>{t("billing.colDate")}</span>
        <span style={{ textAlign: "right" }}>{t("billing.colAmount")}</span>
      </div>
      {loading ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--blg-t2-mute)", margin: "14px 4px 0" }}>
          {t("billing.noTransactions")}
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.id} style={bodyRow}>
            <span style={{ color: "var(--blg-t1-row)" }}>
              {row.description}
              {row.receiptUrl && (
                <a
                  href={row.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 10, fontSize: 12, fontWeight: 600, color: PINK, textDecoration: "underline", textUnderlineOffset: 3 }}
                >
                  {t("billing.receiptLink")}
                </a>
              )}
            </span>
            <span
              style={{
                justifySelf: "start",
                fontSize: 11.5,
                fontWeight: 600,
                color: TAG_COLORS[row.source].color,
                background: TAG_COLORS[row.source].background,
                borderRadius: 99,
                padding: "4px 11px",
              }}
            >
              {t(SOURCE_LABEL_KEYS[row.source])}
            </span>
            <span
              style={{ color: "var(--blg-t2-dim)", fontFamily: MONO_FONT, fontSize: 12.5 }}
            >
              {row.date}
            </span>
            <span style={{ textAlign: "right" }}>
              <span
                style={{
                  fontFamily: MONO_FONT,
                  fontSize: 13,
                  fontWeight: 500,
                  color: row.positive ? "var(--blg-pos)" : "var(--blg-neg)",
                }}
              >
                {row.amount}
              </span>
              {row.usd && (
                <span
                  style={{
                    display: "block",
                    fontFamily: MONO_FONT,
                    fontSize: 11,
                    color: "var(--blg-t2-dim)",
                    marginTop: 2,
                  }}
                >
                  {row.usd}
                </span>
              )}
            </span>
          </div>
        ))
      )}
    </section>
  )
}

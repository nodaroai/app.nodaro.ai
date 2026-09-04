import { Image as ImageIcon, Video, Music, Layers, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT, type MessageKey } from "@/lib/i18n"
import { formatMoney } from "@/lib/format-money"
import type { BillingAccount, MoneyAmount, UsageCategory } from "@/lib/billing-surface"
import { serverUnitLabel } from "@/lib/credit-units"

const ACCENT = "#ff0073"

const CATEGORY_LABEL: Record<string, MessageKey> = {
  image: "usage.catImage", video: "usage.catVideo", audio: "usage.catAudio", other: "usage.catOther",
}
const CATEGORY_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon, video: Video, audio: Music, other: Layers,
}
function categoryLabel(c: string): MessageKey { return CATEGORY_LABEL[c] ?? "usage.catOther" }
function categoryIcon(c: string): typeof ImageIcon { return CATEGORY_ICON[c] ?? Layers }

/** Rule 1: a null amount renders as an em-dash, never a fabricated 0. */
function amountOrDash(n: number | null): string { return n == null ? "—" : n.toLocaleString() }

export function BillingAccountSummary({ account, className = "", consumptionOnly = false }: { account: BillingAccount; className?: string; consumptionOnly?: boolean }) {
  const t = useT()
  const money = (m: MoneyAmount) => formatMoney(m)
  // The account's figures arrive in the display unit and carry it (`unit`);
  // the long-form word is the label when the provider's own id comes back.
  const unit = serverUnitLabel(account.unit, t("credits.unit.other"))
  const daily = account.daily
  const cats: readonly UsageCategory[] = account.byCategory ?? []
  const totalForPct = cats.reduce((s, c) => s + (c.amount ?? 0), 0)

  return (
    <div className={cn("space-y-4", className)}>
      {/* Deployment-payer instances (consumptionOnly): no balance exists at
          user grain — one card with the period's spend replaces the pair. */}
      {consumptionOnly ? (
      <>
        {/* Track A — the requester's own allowance, the one balance that IS
            theirs on a payer instance. `allocated` ABSENT means the provider
            has no allowance concept (mainline, or a backend from before the
            track): no card at all. `allocated`/`balance` NULL means the figure
            was unavailable, which is an em dash — never a manufactured 0,
            because 0 is a real value here and it means "exhausted".

            Both figures arrive ALREADY in the display unit (the seam converted
            them and `unit` is its label), so they render verbatim: passing
            them through creditUnits() would convert a second time.

            The remaining/granted pair is deliberately NOT a `X / Y` string —
            under RTL the operands swap sides and the sentence lies. One
            interpolated key, whose word order the translator owns. */}
        {"allocated" in account && (
          <div data-testid="allowance-card" className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
            <div className="text-sm text-muted-foreground">{t("usage.allowanceRemaining")}</div>
            <div className="mt-1 text-3xl font-bold" style={{ color: ACCENT }}>
              {amountOrDash(account.balance)}
              <span className="ms-2 text-base font-medium text-muted-foreground">{unit}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {account.allocated == null
                ? t("usage.allowanceGrantedUnavailable")
                : t("usage.allowanceOfGranted", { granted: account.allocated.toLocaleString(), unit })}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <div className="text-sm text-muted-foreground">{t("usage.spent")}</div>
          <div className="mt-1 text-3xl font-bold" style={{ color: ACCENT }}>
            {totalForPct.toLocaleString()}
            <span className="ml-2 text-base font-medium text-muted-foreground">{unit}</span>
          </div>
          {account.generations != null && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("usage.generations")}: {account.generations.toLocaleString()}
            </div>
          )}
          {account.periodStart && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("usage.periodFrom", { date: new Date(account.periodStart).toLocaleDateString() })}
            </div>
          )}
        </div>
      </>
      ) : (
      /* Plan + balance + optional spend/reserve cards */
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <div className="text-sm text-muted-foreground">{account.spent ? t("usage.spent") : t("usage.balance")}</div>
          <div className="mt-1 text-3xl font-bold" style={{ color: ACCENT }}>
            {account.spent ? amountOrDash(account.generations ?? account.balance) : amountOrDash(account.balance)}
            {!account.spent && <span className="ml-2 text-base font-medium text-muted-foreground">{unit}</span>}
          </div>
          {account.spent && (
            <div className="mt-1 text-sm font-medium">
              {t("usage.approx", { amount: money(account.spent) })}
              {account.payg?.monthlyCap ? ` ${t("usage.monthlyCap", { cap: money(account.payg.monthlyCap) })}` : ""}
            </div>
          )}
          {account.periodStart && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("usage.periodFrom", { date: new Date(account.periodStart).toLocaleDateString() })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t("usage.balance")}</span>
            <span title={t("usage.plan")} className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-muted-foreground dark:border-zinc-800">
              {account.plan}
            </span>
          </div>
          <div className="mt-1 text-3xl font-bold">
            {amountOrDash(account.balance)}
            <span className="ml-2 text-base font-medium text-muted-foreground">{unit}</span>
          </div>
          {account.reserveValue && (
            <div className="mt-1 text-sm font-medium">
              {t("usage.reserve")}: {t("usage.approx", { amount: money(account.reserveValue) })}
            </div>
          )}
          {account.generations != null && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("usage.generations")}: {account.generations.toLocaleString()}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Daily cap — prefer structured `daily`, else scalar `dailyAllowance`.
          limit 0 is a BLOCK, never "no limit" (rule: 0 ≠ absent). */}
      {(daily || account.dailyAllowance != null) && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">{t("usage.dailyCap")}</span>
            {daily && daily.limit === 0 ? (
              <span className="text-sm text-muted-foreground">{t("usage.dailyBlocked")}</span>
            ) : daily ? (
              <span className="text-sm text-muted-foreground">
                {t("usage.dailyUsedOf", { used: daily.used.toLocaleString(), limit: daily.limit.toLocaleString() })}
              </span>
            ) : account.dailyAllowance != null ? (
              <span className="text-sm text-muted-foreground">
                {t("usage.dailyUsedOf", { used: "0", limit: account.dailyAllowance.toLocaleString() })}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("usage.dailyNone")}</span>
            )}
          </div>
          {daily && daily.limit > 0 && (
            <>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (daily.used / daily.limit) * 100)}%`, backgroundColor: ACCENT }} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {t("usage.dailyResets", { when: new Date(daily.resetsAt).toLocaleString() })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Per-category breakdown */}
      {account.byCategory != null && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-5">
          <h2 className="mb-4 text-base font-semibold">{t("usage.breakdown")}</h2>
          {cats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("usage.empty")}</p>
          ) : (
            <div className="space-y-3">
              {cats.map((item) => {
                const Icon = categoryIcon(item.category)
                const pct = totalForPct > 0 && item.amount != null ? (item.amount / totalForPct) * 100 : 0
                return (
                  <div key={item.category}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{t(categoryLabel(item.category))}</span>
                        <span className="text-xs text-muted-foreground">({item.count})</span>
                      </div>
                      <span className="text-sm tabular-nums">
                        {item.spent ? `${money(item.spent)} · ${amountOrDash(item.amount)}` : amountOrDash(item.amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: ACCENT }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {account.payg?.enabled && (
        <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("usage.paygOn")}</span>
        </div>
      )}
    </div>
  )
}

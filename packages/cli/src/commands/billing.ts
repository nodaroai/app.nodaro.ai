import { Command } from "commander"
import type { BillingMoney, BillingPlan, BillingPriceCredits } from "@nodaro/sdk/billing"
import type { UsageSummaryBucket } from "@nodaro/sdk/credits"
import type { CreditHistoryEntry, CreditHistoryKind, CreditHistoryOptions } from "@nodaro/sdk/credits"
import { buildClient, buildPublicClient, handleError } from "../client.js"
import { detail, dim, emit, info, table, type OutputOpts } from "../output.js"

const SUMMARY_BUCKETS: readonly UsageSummaryBucket[] = ["day", "week", "month"]

interface SummaryOpts extends OutputOpts {
  profile?: string
  since?: string
  until?: string
  bucket?: string
}

const HISTORY_KINDS: readonly CreditHistoryKind[] = ["usage", "purchase", "grant", "refund", "app", "adjustment", "expiry"]

interface HistoryOpts extends OutputOpts {
  profile?: string
  kind?: string
  model?: string
  since?: string
  until?: string
  search?: string
  limit?: string
  cursor?: string
  csv?: boolean
}

/** One history row as the table shows it: a job's charge on its reserve row (the settled charge, the hold while it runs), the movement otherwise. */
function historyRow(e: CreditHistoryEntry): Record<string, unknown> {
  return {
    at: e.at.replace("T", " ").slice(0, 16),
    kind: e.kind,
    what: e.model ?? e.description ?? e.source,
    credits: e.kind === "usage" ? (e.charge ?? e.amount) : e.amount,
    status: e.status ?? "",
    balance: e.balanceAfter,
    job: e.job?.id ?? "",
  }
}

function historyOptions(opts: HistoryOpts): CreditHistoryOptions {
  const kind = opts.kind as CreditHistoryKind | undefined
  if (kind !== undefined && !HISTORY_KINDS.includes(kind)) throw new Error(`--kind must be one of ${HISTORY_KINDS.join(", ")}`)
  const limit = opts.limit === undefined ? undefined : Number(opts.limit)
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new Error("--limit must be a whole number from 1 to 100")
  return { kind, model: opts.model, from: opts.since, to: opts.until, q: opts.search, limit, cursor: opts.cursor }
}

interface GlobalOpts extends OutputOpts {
  profile?: string
}

const GIB = 1024 * 1024 * 1024

function money(m: BillingMoney): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount)
  } catch {
    return `${m.amount} ${m.currency}`
  }
}

/** A price cell: what the plan costs, "free" when there is nothing to pay, "unavailable" when it could not be read. */
function priceCell(plan: BillingPlan, slot: "monthly" | "yearly"): string {
  if (plan.prices === null) return "free"
  if (slot === "monthly") return plan.prices.monthly ? money(plan.prices.monthly) : "unavailable"
  const yearly = plan.prices.yearly
  if (!yearly) return "unavailable"
  return yearly.perMonth === null
    ? money(yearly)
    : `${money(yearly)} (${money({ amount: yearly.perMonth, currency: yearly.currency })} a month)`
}

function grant(credits: BillingPriceCredits): string {
  return `${credits.amount.toLocaleString("en")} / ${credits.per}`
}

/** What the plan grants: the free plan's one-time grant, else what each price states. */
function creditsCell(plan: BillingPlan): string {
  if (plan.signupCredits !== null) return `${plan.signupCredits.toLocaleString("en")} once`
  const monthly = plan.prices?.monthly?.credits ?? null
  const yearly = plan.prices?.yearly?.credits ?? null
  if (monthly && yearly) {
    return monthly.amount === yearly.amount && monthly.per === yearly.per
      ? grant(monthly)
      : `${grant(monthly)} (yearly: ${grant(yearly)})`
  }
  if (monthly) return grant(monthly)
  return yearly ? `yearly: ${grant(yearly)}` : "-"
}

function storageCell(bytes: number): string {
  const gb = bytes / GIB
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
}

export function billingCommand(): Command {
  const cmd = new Command("billing").description(
    "plans and prices, your subscription, and how this deployment bills (buying stays in the app)",
  )

  cmd
    .command("plans")
    .description("the plans and credit packs on sale, with their prices (Nodaro Cloud; no sign-in needed)")
    .option("--profile <name>", "ask this profile's instance (its token is not sent)")
    .option("--base-url <url>", "ask this instance instead (default: the profile's, else https://app.nodaro.ai)")
    .option("--json")
    .addHelpText(
      "after",
      `
Examples:
  $ nodaro billing plans
  $ nodaro billing plans --json`,
    )
    .action(async (opts: GlobalOpts & { baseUrl?: string }) => {
      try {
        // A public route: no sign-in needed, so no credential is sent.
        const client = buildPublicClient({ profile: opts.profile, baseUrl: opts.baseUrl })
        const result = await client.billing.plans()
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(
          result.data.map((plan) => ({
            id: plan.id,
            name: plan.name,
            monthly: priceCell(plan, "monthly"),
            yearly: priceCell(plan, "yearly"),
            credits: creditsCell(plan),
            parallel: plan.parallelism,
            storage: storageCell(plan.storageBytes),
          })),
          ["id", "name", "monthly", "yearly", "credits", "parallel", "storage"],
        )
        info("")
        table(
          result.topUps.map((pack) => ({
            id: pack.id,
            credits: pack.credits.toLocaleString("en"),
            price: pack.price ? money(pack.price) : "unavailable",
          })),
          ["id", "credits", "price"],
        )
        const { min, max, currency } = result.topUpRange
        dim(`Or load any whole amount from ${money({ amount: min, currency })} to ${money({ amount: max, currency })} in the app.`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("subscription")
    .description("your subscription, and the plan your account's entitlements follow (Nodaro Cloud)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.billing.subscription()
        if (opts.json) {
          emit(result, opts)
          return
        }
        if (!result.data) {
          info(`No subscription. Plan in force: ${result.effectiveTier}`)
          return
        }
        detail(result)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("account")
    .description("your plan and balance as this deployment's billing provider reports them, in its unit")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const account = await client.billing.account()
        if (opts.json) {
          emit(account, opts)
          return
        }
        if (account === null) {
          info("The billing provider could not answer right now; this is not a zero balance.")
          return
        }
        detail(account)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("summary")
    .description("your credit usage over a period: totals, by model, by category, over time, by session and by workflow (Nodaro Cloud)")
    .option("--profile <name>")
    .option("--since <when>", "from this time: an ISO-8601 timestamp, or a date (2026-10-01, that whole UTC day); default 30 days ago")
    .option("--until <when>", "up to this time, the same way; default now")
    .option("--bucket <bucket>", "the series over time by day, week or month, in UTC (default day)")
    .option("--json")
    .action(async (opts: SummaryOpts) => {
      try {
        const bucket = opts.bucket as UsageSummaryBucket | undefined
        if (bucket !== undefined && !SUMMARY_BUCKETS.includes(bucket)) throw new Error(`--bucket must be one of ${SUMMARY_BUCKETS.join(", ")}`)
        const client = buildClient(opts.profile)
        const summary = await client.credits.usageSummary({ from: opts.since, to: opts.until, bucket })
        if (opts.json) {
          emit(summary, opts)
          return
        }
        const { totals } = summary
        info(`${summary.period.from.slice(0, 10)} to ${summary.period.to.slice(0, 10)}: ${totals.used} credits on ${totals.runs} runs (avg ${totals.avgPerRun}); bought ${totals.purchased}, granted ${totals.granted}, refunded ${totals.refunded}`)
        if (summary.truncated) dim("(cut at the row cap: the figures under-report; narrow the period)")
        if (summary.partial) dim("(a side read failed: a grouping is missing or unnamed; the totals are whole)")
        table(summary.byModel.map((m) => ({ model: m.model, credits: m.credits, runs: m.runs, share: `${Math.round(m.share * 100)}%` })), ["model", "credits", "runs", "share"])
        table(summary.overTime.map((b) => ({ [summary.period.bucket]: b.bucket, used: b.used, purchased: b.purchased, runs: b.runs })), [summary.period.bucket, "used", "purchased", "runs"])
        if (summary.bySession.length > 0) table(summary.bySession.map((s) => ({ session: s.name ?? s.id, tool: s.tool ?? "", credits: s.credits, runs: s.runs })), ["session", "tool", "credits", "runs"])
        if (summary.byWorkflow.length > 0) table(summary.byWorkflow.map((w) => ({ workflow: w.name ?? w.id, credits: w.credits, runs: w.runs })), ["workflow", "credits", "runs"])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("history")
    .description("every movement of your balance, newest first, with the balance after each (Nodaro Cloud)")
    .option("--profile <name>")
    .option("--kind <kind>", `only ${HISTORY_KINDS.join(" / ")}`)
    .option("--model <id>", "only runs of this model")
    .option("--since <iso>", "from this time (ISO-8601), inclusive")
    .option("--until <iso>", "up to this time (ISO-8601), inclusive")
    .option("--search <words>", "words in the description")
    .option("--limit <n>", "rows per page, 1–100 (default 50)")
    .option("--cursor <cursor>", "the previous page's nextCursor")
    .option("--csv", "the whole filtered history as CSV (no paging; at most 5,000 rows)")
    .option("--json")
    .action(async (opts: HistoryOpts) => {
      try {
        const client = buildClient(opts.profile)
        const options = historyOptions(opts)
        if (opts.csv) {
          const { limit: _limit, cursor: _cursor, ...filters } = options
          process.stdout.write(await client.credits.exportHistory(filters))
          return
        }
        const page = await client.credits.history(options)
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(page.data.map(historyRow), ["at", "kind", "what", "credits", "status", "balance", "job"])
        if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("surface")
    .description("how this deployment bills: whether it meters usage, and the unit costs display in (no sign-in needed)")
    .option("--profile <name>", "ask this profile's instance (its token is not sent)")
    .option("--base-url <url>", "ask this instance instead (default: the profile's, else https://app.nodaro.ai)")
    .option("--json")
    .action(async (opts: GlobalOpts & { baseUrl?: string }) => {
      try {
        const client = buildPublicClient({ profile: opts.profile, baseUrl: opts.baseUrl })
        const surface = await client.billing.surface()
        if (opts.json) {
          emit(surface, opts)
          return
        }
        detail(surface)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

import { z } from "zod"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { routedSettleCandidate, unpaidChargesEnforced } from "../../lib/video-route-policy.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { supabase } from "../../lib/supabase.js"
import { allowanceEnforcementActive, deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { externalWalletConfig, ExternalWalletError, readWalletBalance, reserveWallet, settleWallet, syncWalletDebt, walletCredits, type ExternalWalletConfig } from "./external-wallet-client.js"

const operationSchema = z.object({
  usage_log_id: z.string().uuid(), requester_id: z.string().uuid(), job_id: z.string().uuid().nullable(),
  provider: z.string().min(1), sso_subject: z.string().min(1), model_identifier: z.string(),
  reserved_credits: walletCredits.positive(), authorized_at: z.string().nullable(),
  actual_credits: walletCredits.nullable(), attempts: z.number().int().nonnegative(),
})

export function validateExternalWallet(): ReturnType<typeof externalWalletConfig> {
  const config = externalWalletConfig()
  if (config && (!deploymentPayerActive() || allowanceEnforcementActive())) {
    throw new Error("External wallet requires a deployment payer and billing.allowances=off")
  }
  return config
}

export function externalWalletActive(): boolean { return externalWalletConfig() !== null }

/**
 * Whether this environment ENFORCES unpaid routed charges (Admin → Video
 * route, off by default). Only then does the wallet see anything of the
 * routed-debt contract: with it off every reserve, settle and recovery is the
 * original contract, byte for byte. A settings read that fails counts as off.
 */
async function routedDebtContractActive(): Promise<boolean> {
  try {
    return unpaidChargesEnforced((await getAppSettings()).video_route_policy)
  } catch {
    return false
  }
}

async function hasRoutedReservation(row: z.infer<typeof operationSchema>): Promise<boolean> {
  if (!row.job_id || !routedSettleCandidate(row.model_identifier)) return false
  const { data, error } = await supabase.from("jobs").select("direct:input_data->__videoRoute, run:metadata->videoRouteRun")
    .eq("id", row.job_id).eq("user_id", row.requester_id).single()
  if (error || !data) throw new ExternalWalletError("external_wallet_unavailable")
  return data.direct != null || data.run != null
}

/** Called by EVERY reservation lane, before a usage ID can reach a provider. */
export async function authorizeExternalReservation(usageLogId: string, userId: string): Promise<void> {
  const config = validateExternalWallet()
  if (!config) return
  // A local approval acknowledges a legacy hold. Dispatch a routed run only after
  // receiving the matching capability from this provider, including on replay.
  // (Only where unpaid routed charges are enforced; elsewhere this is the original contract.)
  let routed: boolean | undefined = (await routedDebtContractActive()) ? undefined : false
  let routeConfirmed = false
  try {
    const { data, error } = await supabase.rpc("prepare_external_wallet", {
      p_usage_log_id: usageLogId, p_user_id: userId, p_payer_id: deploymentPayerId(), p_provider: config.provider,
    })
    const parsed = operationSchema.safeParse(data)
    if (error || !parsed.success || parsed.data.usage_log_id !== usageLogId || parsed.data.requester_id !== userId
      || parsed.data.provider !== config.provider || parsed.data.actual_credits !== null) throw new ExternalWalletError("external_wallet_unavailable")
    if (routed === undefined) routed = await hasRoutedReservation(parsed.data)
    if (parsed.data.authorized_at && !routed) return
    await reserveWallet(config, parsed.data, routed)
    routeConfirmed = true
    if (parsed.data.authorized_at) return
    const acknowledged = await supabase.rpc("authorize_external_wallet", { p_usage_log_id: usageLogId })
    if (acknowledged.error || acknowledged.data !== true) throw new ExternalWalletError("external_wallet_unavailable")
  } catch (error) {
    // Also handles a lost prepare/authorize response. SQL locks the usage row;
    // a timeout cannot cancel another caller's already authorized reservation.
    const aborted = await supabase.rpc("abort_external_wallet", { p_usage_log_id: usageLogId })
    if (!aborted.error && aborted.data === true && (routed === false || routeConfirmed)) return
    if (aborted.error) console.error("[external-wallet] reservation cancellation needs recovery", { usageLogId })
    void deliverExternalWalletSettlements(usageLogId)
    throw error instanceof ExternalWalletError ? error : new ExternalWalletError("external_wallet_unavailable")
  }
}

/** Unknown is null. Never fall back to a frozen local allowance/personal grant. */
export async function externalWalletBalance(userId: string): Promise<number | null> {
  const config = validateExternalWallet()
  if (!config) return null
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    const metadata = data.user?.app_metadata
    if (error || metadata?.sso !== config.provider || typeof metadata.sso_subject !== "string" || !metadata.sso_subject) return null
    return await readWalletBalance(config, userId, metadata.sso_subject)
  } catch { return null }
}

const terminalDebt = z.object({
  job_id: z.string().uuid(), requester_id: z.string().uuid(), env: z.string().min(1),
  original_shortfall: walletCredits.positive(), verified_charged: walletCredits, payer: z.literal("external_wallet"),
})

async function deliverWalletCapture(config: ExternalWalletConfig, row: z.infer<typeof operationSchema>): Promise<boolean> {
  let shortfall: number | undefined
  if (row.actual_credits === row.reserved_credits && routedSettleCandidate(row.model_identifier) && await routedDebtContractActive()) {
    // The metered commit persisted the debt and the original capture in one transaction.
    // Read the immutable amount even on replay, regardless of later payments.
    const { data, error } = await supabase.from("video_route_debts")
      .select("env, job_id, requester_id, payer, original_shortfall, verified_charged").eq("usage_log_id", row.usage_log_id).maybeSingle()
    if (error) throw new Error("Wallet settlement evidence unavailable")
    if (data) {
      const debt = terminalDebt.parse(data)
      if (debt.env !== getRuntimeEnv()) return false
      if (!row.authorized_at || debt.job_id !== row.job_id || debt.requester_id !== row.requester_id || debt.verified_charged !== row.actual_credits) {
        throw new Error("Wallet settlement evidence conflicts with the original operation")
      }
      shortfall = debt.original_shortfall
    }
  }
  await settleWallet(config, row, row.actual_credits!, shortfall)
  return true
}

async function deliverWalletOperation(config: ExternalWalletConfig, row: z.infer<typeof operationSchema>): Promise<boolean> {
  try {
    if (!(await deliverWalletCapture(config, row))) return false
    const saved = await supabase.from("external_wallet_operations").update({ delivered_at: new Date().toISOString() })
      .eq("usage_log_id", row.usage_log_id).eq("actual_credits", row.actual_credits!)
    if (saved.error) throw new Error("acknowledgment unavailable")
  } catch {
    const delay = Math.min(3600, 15 * 2 ** Math.min(row.attempts, 8))
    await supabase.from("external_wallet_operations").update({ attempts: row.attempts + 1,
      next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() }).eq("usage_log_id", row.usage_log_id).is("delivered_at", null)
    console.warn("[external-wallet] settlement queued for retry", { usageLogId: row.usage_log_id })
  }
  return true
}

/** At-least-once delivery. The remote contract deduplicates even across replicas. */
export async function deliverExternalWalletSettlements(usageLogId?: string): Promise<void> {
  const config = externalWalletConfig()
  if (!config) return
  try {
    const due = new Date().toISOString()
    // Oldest due first, 25 a pass, as always. An attempted row leaves the due
    // set (delivered, or pushed back); one left for another environment's
    // worker stays in it, so the next page starts past those.
    let skipped = 0
    let budget = 25
    while (budget > 0) {
      let query = supabase.from("external_wallet_operations").select("*")
        .is("delivered_at", null).not("actual_credits", "is", null).eq("provider", config.provider)
      if (usageLogId) query = query.eq("usage_log_id", usageLogId)
      else query = query.lte("next_attempt_at", due)
      const { data, error } = skipped === 0
        ? await query.order("next_attempt_at").limit(budget)
        // (Past the first page the order needs a tiebreak to page stably.)
        : await query.order("next_attempt_at").order("usage_log_id").range(skipped, skipped + budget - 1)
      if (error) throw new Error("outbox unavailable")
      const rows = z.array(operationSchema).parse(data ?? [])
      const lastPage = rows.length < budget
      for (let offset = 0; offset < rows.length; offset += 5) {
        const attempted = await Promise.all(rows.slice(offset, offset + 5).map(row => deliverWalletOperation(config, row)))
        budget -= attempted.filter(Boolean).length
        skipped += attempted.filter((done) => !done).length
      }
      // A foreign environment's pending captures must not starve this wallet.
      if (usageLogId || lastPage) return
    }
  } catch { console.error("[external-wallet] settlement outbox could not be read") }
}

const outstandingDebt = z.object({
  usage_log_id: z.string().uuid(), job_id: z.string().uuid(), requester_id: z.string().uuid(),
  original_shortfall: walletCredits.positive(), remaining: walletCredits.positive(),
})

async function recoverWalletDebt(config: ExternalWalletConfig, debt: z.infer<typeof outstandingDebt>): Promise<void> {
  const { data, error } = await supabase.from("external_wallet_operations").select("*")
    .eq("usage_log_id", debt.usage_log_id).eq("provider", config.provider).maybeSingle()
  if (error) throw new Error("Wallet operation unavailable")
  // An operation from a different provider belongs to its own recovery worker.
  if (!data) return
  const op = operationSchema.parse(data)
  if (op.usage_log_id !== debt.usage_log_id || op.job_id !== debt.job_id || op.requester_id !== debt.requester_id || op.provider !== config.provider ||
      !op.authorized_at || op.actual_credits !== op.reserved_credits) throw new Error("Wallet settlement does not match the original reservation")
  // Capture and registration must both be acknowledged before reading a payment.
  if (!data.delivered_at) return
  const receipt = await syncWalletDebt(config, op, debt.original_shortfall, debt.remaining)
  if (!receipt) return
  const applied = await supabase.rpc("repay_external_video_route_debt", {
    p_usage_log_id: op.usage_log_id, p_provider: op.provider, p_receipt_id: receipt.id, p_credits: receipt.credits,
  })
  if (applied.error || applied.data?.usageLogId !== op.usage_log_id || applied.data?.recovered !== receipt.credits ||
      applied.data?.remaining !== debt.remaining - receipt.credits) throw new Error("Wallet collection acknowledgement unavailable")
}

/** Keyset pagination lets unfunded accounts and temporarily unavailable wallets coexist with successful collections. */
export async function recoverExternalWalletDebts(config: ExternalWalletConfig): Promise<void> {
  let cursor: string | undefined
  for (;;) {
    let query = supabase.from("video_route_debts").select("usage_log_id, job_id, requester_id, original_shortfall, remaining")
      .eq("env", getRuntimeEnv()).eq("payer", "external_wallet").gt("remaining", 0)
    if (cursor) query = query.gt("usage_log_id", cursor)
    const { data, error } = await query.order("usage_log_id").limit(50)
    if (error) throw new Error("Wallet debt ledger unavailable")
    const debts = z.array(outstandingDebt).parse(data)
    for (let offset = 0; offset < debts.length; offset += 5) {
      await Promise.all(debts.slice(offset, offset + 5).map(async debt => {
        try { await recoverWalletDebt(config, debt) }
        catch { console.warn("[external-wallet] debt collection awaits a confirmed receipt", { usageLogId: debt.usage_log_id }) }
      }))
    }
    if (debts.length < 50) return
    cursor = debts[debts.length - 1]!.usage_log_id
  }
}

let reconciling = false
export async function reconcileExternalWallet(): Promise<void> {
  const config = externalWalletConfig()
  if (!config || reconciling) return
  reconciling = true
  try {
    // A provider can only run after authorized_at is durable. Unknown reserves
    // left by a crashed process can therefore safely become terminal releases.
    const { data, error } = await supabase.from("external_wallet_operations").select("usage_log_id")
      .eq("provider", config.provider).is("authorized_at", null).is("actual_credits", null)
      .lt("created_at", new Date(Date.now() - 120000).toISOString()).limit(100)
    if (error) throw new Error("recovery unavailable")
    for (const row of data ?? []) {
      const aborted = await supabase.rpc("abort_external_wallet", { p_usage_log_id: row.usage_log_id })
      if (aborted.error) console.error("[external-wallet] orphan cancellation needs retry", { usageLogId: row.usage_log_id })
    }
    await deliverExternalWalletSettlements()
    if (await routedDebtContractActive()) await recoverExternalWalletDebts(config)
  } catch { console.error("[external-wallet] recovery failed; will retry") }
  finally { reconciling = false }
}

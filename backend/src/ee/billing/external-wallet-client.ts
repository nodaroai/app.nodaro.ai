import { z } from "zod"
import { ReserveRpcError } from "../../lib/reserve-errors.js"

export interface ExternalWalletConfig {
  url: string
  token: string
  provider: string
  timeoutMs: number
}

/** Configuration is server-only. A partially configured wallet never fails open. */
export function externalWalletConfig(env = process.env): ExternalWalletConfig | null {
  const url = env.DEPLOYMENT_WALLET_URL?.trim()
  const token = env.DEPLOYMENT_WALLET_TOKEN?.trim()
  const provider = env.DEPLOYMENT_WALLET_SSO_PROVIDER?.trim()
  if (!url && !token && !provider) return null
  if (!url || !token || !provider) throw new Error("Configure DEPLOYMENT_WALLET_URL, TOKEN and SSO_PROVIDER together")
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("DEPLOYMENT_WALLET_URL must be an HTTPS endpoint without credentials or a fragment")
  }
  const timeoutMs = Number(env.DEPLOYMENT_WALLET_TIMEOUT_MS ?? 10000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("Invalid DEPLOYMENT_WALLET_TIMEOUT_MS")
  return { url, token, provider, timeoutMs }
}

export const walletCredits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const receiptBase = { contract: z.literal(1), unit: z.literal("nodaro_credit") }
const reservationReply = z.discriminatedUnion("decision", [
  z.object({ ...receiptBase, operation_id: z.string().uuid(), decision: z.literal("allow"), reserved_credits: walletCredits }),
  z.object({ ...receiptBase, operation_id: z.string().uuid(), decision: z.literal("deny") }),
])
const routedReceiptBase = { contract: z.literal(2), unit: z.literal("nodaro_credit") }
const routedReservationReply = z.discriminatedUnion("decision", [
  z.object({ ...routedReceiptBase, operation_id: z.string().uuid(), decision: z.literal("allow"),
    capability: z.literal("routed_debt_v1"), reserved_credits: walletCredits }),
  z.object({ ...routedReceiptBase, operation_id: z.string().uuid(), decision: z.literal("deny") }),
])
const debtReply = z.object({
  ...routedReceiptBase, operation_id: z.string().uuid(), sso_provider: z.string(), sso_subject: z.string(),
  original_shortfall: walletCredits.positive(), after_credits: walletCredits,
  receipt: z.object({ id: z.string().min(1).max(200), credits: walletCredits.positive() }).nullable(),
})
const settlementReply = z.object({ ...receiptBase, operation_id: z.string().uuid(), settled: z.literal(true), actual_credits: walletCredits })
const overageSettlementReply = settlementReply.extend({
  ...routedReceiptBase, sso_provider: z.string(), sso_subject: z.string(),
  original_shortfall: walletCredits.positive(), debt_registered: z.literal(true),
})
// A partner's budget can contain less than one billable credit. Preserve that
// remainder for display; reserve and settlement amounts remain whole credits.
const balanceReply = z.object({ ...receiptBase, sso_subject: z.string().min(1), available_credits: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER) })

export class ExternalWalletError extends ReserveRpcError {
  constructor(readonly code: "external_wallet_denied" | "external_wallet_unavailable") {
    super(code.toUpperCase(), code)
    this.name = "ExternalWalletError"
  }
}

export interface WalletOperation {
  usage_log_id: string
  job_id: string | null
  requester_id: string
  sso_subject: string
  provider: string
  reserved_credits: number
  model_identifier: string
}

/** Never log response bodies: the remote wallet may include private account data. */
async function post(config: ExternalWalletConfig, body: object, key?: string): Promise<unknown> {
  try {
    const response = await fetch(config.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs),
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify({ contract: 1, unit: "nodaro_credit", ...body }),
    })
    if (!response.ok) throw new Error("wallet HTTP failure")
    // Bound the body while streaming, not after allocating arbitrary remote bytes.
    const reader = response.body?.getReader()
    if (!reader) throw new Error("empty wallet response")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 16384) throw new Error("oversized wallet response")
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch { throw new ExternalWalletError("external_wallet_unavailable") }
}

function operationBody(row: WalletOperation) {
  return { operation_id: row.usage_log_id, job_id: row.job_id, user_id: row.requester_id,
    sso_provider: row.provider, sso_subject: row.sso_subject, model_identifier: row.model_identifier,
    reserved_credits: row.reserved_credits }
}

export async function reserveWallet(config: ExternalWalletConfig, row: WalletOperation, routed = false): Promise<void> {
  const body = { action: "reserve", ...operationBody(row), ...(routed ? { contract: 2, capability: "routed_debt_v1" } : {}) }
  const response = await post(config, body, `${row.usage_log_id}:reserve`)
  const reply = routed ? routedReservationReply.safeParse(response) : reservationReply.safeParse(response)
  if (!reply.success || reply.data.operation_id !== row.usage_log_id) throw new ExternalWalletError("external_wallet_unavailable")
  if (reply.data.decision === "deny") throw new ExternalWalletError("external_wallet_denied")
  if (reply.data.reserved_credits !== row.reserved_credits) throw new ExternalWalletError("external_wallet_unavailable")
}

export async function settleWallet(config: ExternalWalletConfig, row: WalletOperation, actual: number, shortfall?: number): Promise<void> {
  if (!walletCredits.safeParse(actual).success || actual > row.reserved_credits) throw new ExternalWalletError("external_wallet_unavailable")
  const body = { action: "settle", ...operationBody(row), actual_credits: actual }
  const key = `${row.usage_log_id}:settle`
  if (shortfall !== undefined) {
    if (!walletCredits.positive().safeParse(shortfall).success || actual !== row.reserved_credits || actual <= 0 || row.provider !== config.provider) {
      throw new ExternalWalletError("external_wallet_unavailable")
    }
    const reply = overageSettlementReply.safeParse(await post(config, { ...body, contract: 2, original_shortfall: shortfall }, key))
    if (!reply.success || reply.data.operation_id !== row.usage_log_id || reply.data.actual_credits !== actual ||
        reply.data.sso_provider !== row.provider || reply.data.sso_subject !== row.sso_subject || reply.data.original_shortfall !== shortfall) {
      throw new ExternalWalletError("external_wallet_unavailable")
    }
    return
  }
  const reply = settlementReply.safeParse(await post(config, body, key))
  if (!reply.success || reply.data.operation_id !== row.usage_log_id || reply.data.actual_credits !== actual) throw new ExternalWalletError("external_wallet_unavailable")
}

export async function readWalletBalance(config: ExternalWalletConfig, userId: string, subject: string): Promise<number> {
  const reply = balanceReply.safeParse(await post(config, { action: "balance", user_id: userId, sso_provider: config.provider, sso_subject: subject }))
  if (!reply.success || reply.data.sso_subject !== subject) throw new ExternalWalletError("external_wallet_unavailable")
  return reply.data.available_credits
}

/** Read the next durable collection on an acknowledged obligation after a verified credit offset. */
export async function syncWalletDebt(config: ExternalWalletConfig, row: WalletOperation, original: number, remaining: number) {
  if (!walletCredits.positive().safeParse(original).success || !walletCredits.positive().safeParse(remaining).success ||
      remaining > original || row.provider !== config.provider) throw new ExternalWalletError("external_wallet_unavailable")
  const after = original - remaining
  const reply = debtReply.safeParse(await post(config, {
    contract: 2, action: "sync_debt", ...operationBody(row), original_shortfall: original, after_credits: after,
  }))
  if (!reply.success || reply.data.operation_id !== row.usage_log_id || reply.data.sso_provider !== row.provider ||
      reply.data.sso_subject !== row.sso_subject || reply.data.original_shortfall !== original ||
      reply.data.after_credits !== after || (reply.data.receipt && reply.data.receipt.credits > remaining)) {
    throw new ExternalWalletError("external_wallet_unavailable")
  }
  return reply.data.receipt
}

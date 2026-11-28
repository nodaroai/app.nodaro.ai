import { afterEach, describe, expect, it, vi } from "vitest"
import { externalWalletConfig, reserveWallet, settleWallet, syncWalletDebt, readWalletBalance, type WalletOperation } from "../external-wallet-client.js"

const config = { url: "https://wallet.example.test", token: "test-only", provider: "sai", timeoutMs: 1000 }
const operation: WalletOperation = { usage_log_id: "00000000-0000-4000-8000-000000000001", requester_id: "00000000-0000-4000-8000-000000000002",
  job_id: null, provider: "sai", sso_subject: "partner-user", reserved_credits: 30, model_identifier: "test-model" }
const base = { contract: 1, unit: "nodaro_credit", operation_id: operation.usage_log_id }
function respond(body: unknown) { return vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))) }
afterEach(() => vi.unstubAllGlobals())

describe("external wallet protocol", () => {
  it("is dormant only when all authority settings are absent", () => {
    expect(externalWalletConfig({})).toBeNull()
    expect(() => externalWalletConfig({ DEPLOYMENT_WALLET_URL: config.url })).toThrow(/together/)
    expect(() => externalWalletConfig({ DEPLOYMENT_WALLET_URL: "http://wallet.test", DEPLOYMENT_WALLET_TOKEN: "x", DEPLOYMENT_WALLET_SSO_PROVIDER: "sai" })).toThrow(/HTTPS/)
  })
  it("sends a stable key, integer credit denomination and trusted identity without prompts", async () => {
    respond({ ...base, decision: "allow", reserved_credits: 30 })
    await reserveWallet(config, operation)
    const [, request] = vi.mocked(fetch).mock.calls[0]!
    expect(request).toMatchObject({ redirect: "error", headers: { "Idempotency-Key": `${operation.usage_log_id}:reserve` } })
    expect(JSON.parse(request!.body as string)).toEqual({ ...base, action: "reserve", job_id: null, user_id: operation.requester_id,
      sso_provider: "sai", sso_subject: "partner-user", reserved_credits: 30, model_identifier: "test-model" })
  })
  it.each([
    { ...base, decision: "allow", reserved_credits: 29 },
    { ...base, decision: "allow", reserved_credits: "30" },
    { ...base, decision: "allow", reserved_credits: 30, operation_id: operation.requester_id },
    { ...base, decision: "allow", reserved_credits: 30, unit: "tokens" },
    { decision: "allow" },
  ])("refuses a malformed or mismatched authorization %#", async body => {
    respond(body)
    await expect(reserveWallet(config, operation)).rejects.toMatchObject({ code: "external_wallet_unavailable" })
  })
  it("distinguishes denial from outage", async () => {
    respond({ ...base, decision: "deny" })
    await expect(reserveWallet(config, operation)).rejects.toMatchObject({ code: "external_wallet_denied" })
  })
  it("fails closed on network timeouts without exposing exception contents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private account details")))
    await expect(reserveWallet(config, operation)).rejects.toMatchObject({ code: "external_wallet_unavailable" })
    await expect(reserveWallet(config, operation)).rejects.not.toThrow(/private/)
  })
  it.each([0, 12, 30])("settles exactly %i credits with the terminal idempotency key", async actual => {
    respond({ ...base, settled: true, actual_credits: actual })
    await settleWallet(config, operation, actual)
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ headers: { "Idempotency-Key": `${operation.usage_log_id}:settle` } })
  })
  it("rejects charges above the reservation without contacting the wallet", async () => {
    respond({ ...base, settled: true, actual_credits: 31 })
    await expect(settleWallet(config, operation, 31)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it("does not accept another user's balance", async () => {
    respond({ contract: 1, unit: "nodaro_credit", sso_subject: "someone-else", available_credits: 300 })
    await expect(readWalletBalance(config, operation.requester_id, operation.sso_subject)).rejects.toThrow()
  })
  it("preserves a fractional shared balance while charges remain whole credits", async () => {
    respond({ contract: 1, unit: "nodaro_credit", sso_subject: operation.sso_subject, available_credits: 0.0155 })
    expect(await readWalletBalance(config, operation.requester_id, operation.sso_subject)).toBe(0.0155)
  })
  it("requires the routed debt capability on a routed reserve even when the original amount matches", async () => {
    for (const reply of [{ ...base }, { ...base, contract: 2 }]) {
      respond({ ...reply, decision: "allow", reserved_credits: 30 })
      await expect(reserveWallet(config, operation, true)).rejects.toThrow()
    }
    respond({ ...base, contract: 2, decision: "allow", reserved_credits: 30, capability: "routed_debt_v1" })
    await reserveWallet(config, operation, true)
    const request = vi.mocked(fetch).mock.calls[0]![1]!
    expect(JSON.parse(request.body as string)).toMatchObject({ contract: 2, capability: "routed_debt_v1", action: "reserve" })
    expect(request.headers).toMatchObject({ "Idempotency-Key": `${operation.usage_log_id}:reserve` })
  })

  const confirmation = { ...base, contract: 2, sso_provider: operation.provider, sso_subject: operation.sso_subject,
    original_shortfall: 12, after_credits: 5, receipt: { id: "topup-installment-2", credits: 3 } }
  const registered = { ...base, contract: 2, sso_provider: operation.provider, sso_subject: operation.sso_subject,
    settled: true, actual_credits: 30, original_shortfall: 12, debt_registered: true }
  it("captures the hold and registers the exact overage with the same terminal key on replay", async () => {
    respond(registered)
    await settleWallet(config, operation, 30, 12)
    const request = vi.mocked(fetch).mock.calls[0]![1]!
    expect(JSON.parse(request.body as string)).toMatchObject({ contract: 2, action: "settle", actual_credits: 30, original_shortfall: 12 })
    expect(request.headers).toMatchObject({ "Idempotency-Key": `${operation.usage_log_id}:settle` })
  })
  it.each([{ contract: 1 }, { debt_registered: false }, { original_shortfall: 11 }, { sso_subject: "other" }])(
    "requires confirmation of the matching overage before acknowledging capture %#", async patch => {
      respond({ ...registered, ...patch })
      await expect(settleWallet(config, operation, 30, 12)).rejects.toThrow()
    })
  it("reads a partial collection from the original obligation, including an unfunded wait", async () => {
    respond(confirmation)
    expect(await syncWalletDebt(config, operation, 12, 7)).toEqual(confirmation.receipt)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toMatchObject({ contract: 2, action: "sync_debt", original_shortfall: 12, after_credits: 5 })
    respond({ ...confirmation, receipt: null })
    expect(await syncWalletDebt(config, operation, 12, 7)).toBeNull()
  })
  it.each([
    { contract: 1 }, { operation_id: operation.requester_id }, { sso_provider: "another" }, { sso_subject: "another" },
    { after_credits: 0 }, { original_shortfall: 11 }, { receipt: { id: "", credits: 3 } },
    { receipt: { id: "over", credits: 8 } }, { receipt: { id: "zero", credits: 0 } },
    { receipt: { id: "fraction", credits: 2.5 } },
  ])("rejects a conflicting debt confirmation %#", async change => {
    respond({ ...confirmation, ...change })
    await expect(syncWalletDebt(config, operation, 12, 7)).rejects.toMatchObject({ code: "external_wallet_unavailable" })
  })
  it("bounds response size", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(16385))))
    await expect(reserveWallet(config, operation)).rejects.toThrow()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUserById: vi.fn(), active: vi.fn(() => true), enforced: vi.fn(() => false), debtEnforced: false, settingsFail: false }))
// Admin → Video route's "enforce unpaid charges" (off unless saved on).
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => {
  if (mocks.settingsFail) throw new Error("settings unavailable")
  return { video_route_policy: mocks.debtEnforced ? { models: {}, enforceUnpaidCharges: true } : null }
} }))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, auth: { admin: { getUserById: mocks.getUserById } } } }))
vi.mock("../../../lib/deployment-payer.js", () => ({ deploymentPayerActive: mocks.active, allowanceEnforcementActive: mocks.enforced, deploymentPayerId: () => "00000000-0000-4000-8000-000000000003" }))
import { authorizeExternalReservation, deliverExternalWalletSettlements, recoverExternalWalletDebts, reconcileExternalWallet, externalWalletBalance, validateExternalWallet } from "../external-wallet.js"
const id = "00000000-0000-4000-8000-000000000001"
const user = "00000000-0000-4000-8000-000000000002"
const row = { usage_log_id: id, requester_id: user, job_id: null, provider: "sai", sso_subject: "trusted",
  model_identifier: "test", reserved_credits: 20, authorized_at: null, actual_credits: null, attempts: 0 }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.example.test")
  vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", "test-only")
  vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "sai")
  mocks.active.mockReturnValue(true); mocks.enforced.mockReturnValue(false)
  mocks.debtEnforced = false; mocks.settingsFail = false
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ contract: 1, unit: "nodaro_credit", operation_id: id, decision: "allow", reserved_credits: 20 }))))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe("durable wallet authorization", () => {
  it("does nothing when disabled", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", ""); vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", ""); vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "")
    await authorizeExternalReservation(id, user)
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
  it("rejects two simultaneously enforced customer budgets", () => {
    mocks.enforced.mockReturnValue(true)
    expect(() => validateExternalWallet()).toThrow(/allowances=off/)
  })
  it("persists intent before network access and approval before returning", async () => {
    mocks.rpc.mockImplementation(async name => {
      if (name === "prepare_external_wallet") { expect(fetch).not.toHaveBeenCalled(); return { data: row, error: null } }
      expect(fetch).toHaveBeenCalledOnce(); return { data: true, error: null }
    })
    await authorizeExternalReservation(id, user)
    expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(["prepare_external_wallet", "authorize_external_wallet"])
  })
  it("reuses a persisted approval without another reserve", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, authorized_at: new Date().toISOString() }, error: null })
    await authorizeExternalReservation(id, user)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("refuses dispatch if cancellation won before authorization acknowledgement", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: false, error: null })
    await expect(authorizeExternalReservation(id, user)).rejects.toThrow()
    expect(mocks.rpc.mock.calls[2]![0]).toBe("abort_external_wallet")
  })
  it("recovers a lost approval reply without cancelling an authorized operation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: null, error: { message: "lost reply" } }).mockResolvedValueOnce({ data: true, error: null })
    await expect(authorizeExternalReservation(id, user)).resolves.toBeUndefined()
  })
  it("missing trusted identity stops network dispatch and refunds the local hold", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "identity missing" } }).mockResolvedValueOnce({ data: false, error: null })
    await expect(authorizeExternalReservation(id, user)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith("abort_external_wallet", { p_usage_log_id: id })
  })
  it("ignores user-editable identity metadata", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { app_metadata: {}, user_metadata: { sso: "sai", sso_subject: "forged" } } }, error: null })
    expect(await externalWalletBalance(user)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps settlement pending after a lost response and reuses the terminal key on retry", async () => {
    const writes: Record<string, unknown>[] = []
    const terminal = { ...row, actual_credits: 7, authorized_at: new Date().toISOString() }
    mocks.from.mockImplementation(() => {
      let writing = false
      const chain: Record<string, unknown> = {}
      for (const name of ["select", "is", "not", "eq", "lte", "order", "limit"]) chain[name] = () => chain
      chain.update = (value: Record<string, unknown>) => { writing = true; writes.push(value); return chain }
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ data: writing ? null : [terminal], error: null }).then(resolve, reject)
      return chain
    })
    vi.mocked(fetch).mockRejectedValueOnce(new Error("response lost"))
    await deliverExternalWalletSettlements(id)
    expect(writes).toContainEqual(expect.objectContaining({ attempts: 1 }))
    expect(writes.some(w => "delivered_at" in w)).toBe(false)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ contract: 1, unit: "nodaro_credit", operation_id: id, settled: true, actual_credits: 7 })))
    await deliverExternalWalletSettlements(id)
    expect(writes.some(w => "delivered_at" in w)).toBe(true)
    expect(vi.mocked(fetch).mock.calls.map(call => (call[1]?.headers as Record<string, string>)["Idempotency-Key"]))
      .toEqual([`${id}:settle`, `${id}:settle`])
  })
})

describe("routed external wallet collections", () => {
  const config = { provider: "sai", token: "test", url: "https://wallet.example.test", timeoutMs: 1000 }
  const jobId = "00000000-0000-4000-8000-000000000011"
  const debt = { usage_log_id: id, job_id: jobId, requester_id: user, original_shortfall: 15, remaining: 10 }
  const operation = { ...row, job_id: jobId, actual_credits: 20, authorized_at: "2026-01-02", delivered_at: "2026-01-02" }
  function queryResult(data: unknown) {
    const q = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() }
    for (const chain of [q.select, q.eq, q.gt, q.order]) chain.mockReturnValue(q)
    for (const end of [q.limit, q.maybeSingle, q.single]) end.mockResolvedValue({ data, error: null })
    return q
  }
  beforeEach(() => { mocks.debtEnforced = true })
  it("retains an outstanding wallet instalment after a lost local receipt and replays the provider receipt", async () => {
    const ledger = queryResult([debt])
    const wallet = queryResult(operation)
    mocks.from.mockImplementation(name => name === "video_route_debts" ? ledger : wallet)
    const receipt = { contract: 2, unit: "nodaro_credit", operation_id: id, sso_provider: "sai", sso_subject: "trusted",
      original_shortfall: 15, after_credits: 5, receipt: { id: "purchase-7", credits: 4 } }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt))))
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "lost reply" } })
      .mockResolvedValueOnce({ data: { usageLogId: id, recovered: 4, remaining: 6 }, error: null })
    await recoverExternalWalletDebts(config)
    await recoverExternalWalletDebts(config)
    const args = { p_usage_log_id: id, p_provider: "sai", p_receipt_id: "purchase-7", p_credits: 4 }
    expect(mocks.rpc.mock.calls).toEqual([["repay_external_video_route_debt", args], ["repay_external_video_route_debt", args]])
    expect(ledger.eq).toHaveBeenCalledWith("payer", "external_wallet")
    expect(ledger.eq).toHaveBeenCalledWith("env", expect.any(String))
    expect(wallet.eq).toHaveBeenCalledWith("provider", "sai")
  })
  it("waits for delivery of the original settlement before collecting an overage", async () => {
    mocks.from.mockImplementation(name => queryResult(name === "video_route_debts" ? [debt] : { ...operation, delivered_at: null }))
    await recoverExternalWalletDebts(config)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("keeps the terminal outbox open until the wallet confirms registration of this customer's original debt", async () => {
    vi.stubEnv("RUNTIME_ENV", "wallet-test")
    const terminal = { ...operation, model_identifier: "ugc-clip", delivered_at: null }
    const writes: Record<string, unknown>[] = []
    const wallet = {
      ...queryResult([terminal]), is: vi.fn(), not: vi.fn(), update: vi.fn(),
    }
    for (const method of [wallet.is, wallet.not, wallet.select, wallet.eq, wallet.order]) method.mockReturnValue(wallet)
    wallet.update.mockImplementation((fields: Record<string, unknown>) => { writes.push(fields); return wallet })
    const captureDebt = { ...debt, env: "wallet-test", payer: "external_wallet", verified_charged: 20 }
    const debtQuery = queryResult(captureDebt)
    mocks.from.mockImplementation(name => name === "video_route_debts" ? debtQuery : wallet)
    const reply = { contract: 2, unit: "nodaro_credit", operation_id: id, settled: true, actual_credits: 20,
      sso_provider: "sai", sso_subject: "trusted", original_shortfall: 15, debt_registered: true }
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...reply, debt_registered: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify(reply))))
    await deliverExternalWalletSettlements(id)
    expect(writes.some(w => "delivered_at" in w)).toBe(false)
    await deliverExternalWalletSettlements(id)
    expect(writes.some(w => "delivered_at" in w)).toBe(true)
    for (const call of vi.mocked(fetch).mock.calls) expect(JSON.parse(call[1]!.body as string)).toMatchObject({
      contract: 2, action: "settle", actual_credits: 20, original_shortfall: 15,
    })
    debtQuery.maybeSingle.mockResolvedValueOnce({ error: { message: "unavailable" } })
    await deliverExternalWalletSettlements(id)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("requires the same customer on the unpaid receipt and original wallet operation", async () => {
    mocks.from.mockImplementation(name => queryResult(name === "video_route_debts" ? [{ ...debt, requester_id: jobId }] : operation))
    await recoverExternalWalletDebts(config)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("scans past a page of overdue foreign captures to deliver an ordinary full capture in this environment", async () => {
    vi.stubEnv("RUNTIME_ENV", "wallet-test")
    const foreign = Array.from({ length: 25 }, (_, i) => ({
      ...operation, model_identifier: "ugc-clip", usage_log_id: `00000000-0000-4000-8000-${String(i + 101).padStart(12, "0")}`,
    }))
    const local = { ...operation, model_identifier: "ugc-clip", usage_log_id: "00000000-0000-4000-8000-000000000201" }
    const pages = vi.fn().mockResolvedValueOnce({ data: foreign }).mockResolvedValueOnce({ data: [local] })
    const writes = vi.fn()
    mocks.from.mockImplementation(name => {
      if (name === "video_route_debts") {
        const q = queryResult(null)
        q.eq.mockImplementation((_key, usageLogId) => {
          q.maybeSingle.mockResolvedValue({ data: usageLogId === local.usage_log_id ? null :
            { ...debt, env: "another", payer: "external_wallet", verified_charged: 20 } })
          return q
        })
        return q
      }
      const q = { ...queryResult(null), is: vi.fn(), not: vi.fn(), lte: vi.fn(), limit: pages, range: pages, update: writes }
      for (const chain of [q.select, q.is, q.not, q.eq, q.lte, q.gt, q.order, q.update]) chain.mockReturnValue(q)
      return q
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      contract: 1, unit: "nodaro_credit", operation_id: local.usage_log_id, settled: true, actual_credits: 20,
    }))))
    await deliverExternalWalletSettlements()
    expect(pages).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({
      contract: 1, operation_id: local.usage_log_id, actual_credits: 20,
    })
    expect(writes).toHaveBeenCalledExactlyOnceWith({ delivered_at: expect.any(String) })
  })
  it("refuses a routed replay with a previous local authorization when the wallet only supports ordinary holds", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...row, job_id: jobId, model_identifier: "ugc-clip", authorized_at: "2026-01-02" } })
      .mockResolvedValueOnce({ data: true })
    mocks.from.mockReturnValue(queryResult({ run: { token: "bound" } }))
    await expect(authorizeExternalReservation(id, user)).rejects.toMatchObject({ code: "external_wallet_unavailable" })
  })
})

describe("unpaid routed charges not enforced (the default): the original wallet contract, unchanged", () => {
  const jobId = "00000000-0000-4000-8000-000000000011"
  const routedRow = { ...row, job_id: jobId, model_identifier: "ugc-clip" }
  it.each([false, true])("a routed reservation is an ordinary contract-1 reserve, with no read of the job (settings read failed: %s)", async (settingsFail) => {
    mocks.settingsFail = settingsFail
    mocks.rpc.mockResolvedValueOnce({ data: routedRow, error: null }).mockResolvedValueOnce({ data: true, error: null })
    await authorizeExternalReservation(id, user)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toMatchObject({ contract: 1, action: "reserve" })
    expect(body).not.toHaveProperty("capability")
  })
  it("a routed replay with a previous authorization returns without asking the wallet again", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...routedRow, authorized_at: "2026-01-02" }, error: null })
    await authorizeExternalReservation(id, user)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("a full capture of a routed run with a recorded unpaid charge is an ordinary contract-1 settle", async () => {
    const terminal = { ...routedRow, actual_credits: 20, authorized_at: "2026-01-02" }
    const tables: string[] = []
    mocks.from.mockImplementation((name: string) => {
      tables.push(name)
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "is", "not", "eq", "lte", "order", "limit", "update"]) chain[m] = () => chain
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [terminal], error: null }).then(resolve)
      return chain
    })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ contract: 1, unit: "nodaro_credit", operation_id: id, settled: true, actual_credits: 20 })))
    await deliverExternalWalletSettlements(id)
    expect(tables).not.toContain("video_route_debts")
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toMatchObject({ contract: 1, action: "settle", actual_credits: 20 })
    expect(body).not.toHaveProperty("original_shortfall")
  })
  it("the recovery worker never reads a debt or asks the wallet for an instalment", async () => {
    const tables: string[] = []
    mocks.from.mockImplementation((name: string) => {
      tables.push(name)
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "is", "not", "eq", "lte", "lt", "order"]) chain[m] = () => chain
      chain.limit = async () => ({ data: [], error: null })
      return chain
    })
    await reconcileExternalWallet()
    expect(tables).not.toContain("video_route_debts")
    expect(fetch).not.toHaveBeenCalled()
  })
})

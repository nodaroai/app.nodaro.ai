import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  configurePayer: vi.fn(),
  validateWallet: vi.fn(),
  startWorker: vi.fn(),
}))

vi.mock("../config.js", () => ({ hasCredits: () => true }))
vi.mock("../deployment-payer.js", () => ({ configureDeploymentPayer: mocks.configurePayer }))
vi.mock("../../ee/billing/external-wallet.js", () => ({ validateExternalWallet: mocks.validateWallet }))
vi.mock("../overlay/load.js", () => ({ loadOverlay: async () => { mocks.events.push("overlay") } }))
vi.mock("../availability-override.js", () => ({ loadAvailabilityOverrides: async () => {} }))
vi.mock("../prompt-policies/index.js", () => ({ registerMainlinePromptPolicies: () => {} }))
vi.mock("../worker-drain.js", () => ({ beginWorkerDrain: () => {}, SHUTDOWN_DRAIN_MS: 1000 }))
vi.mock("../../workers/orchestrator-worker.js", () => ({ createOrchestratorWorker: mocks.startWorker }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.events.length = 0
  vi.stubEnv("DEPLOYMENT_WALLET_URL", "https://wallet.example.test")
  vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", "test-token")
  vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "partner")
  mocks.configurePayer.mockImplementation(async () => {
    mocks.events.push("payer")
    return { ok: true }
  })
  mocks.validateWallet.mockImplementation(() => { mocks.events.push("wallet") })
  mocks.startWorker.mockImplementation(() => { mocks.events.push("worker"); return { close: vi.fn() } })
  // Entrypoint imports must not leave signal handlers attached to the test runner.
  vi.spyOn(process, "on").mockReturnValue(process)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("standalone orchestrator wallet boot", () => {
  it("initializes the deployment payer and wallet after the overlay, before accepting executions", async () => {
    await import("../../orchestrator.js")
    expect(mocks.events).toEqual(["overlay", "payer", "wallet", "worker"])
  })

  it("does not accept executions if payer initialization fails", async () => {
    mocks.configurePayer.mockResolvedValue({ ok: false, reason: "payer unavailable" })
    await expect(import("../../orchestrator.js")).rejects.toThrow("External wallet payer could not be initialized")
    expect(mocks.startWorker).not.toHaveBeenCalled()
  })

  it("does not accept executions with invalid wallet configuration", async () => {
    mocks.validateWallet.mockImplementation(() => { throw new Error("invalid wallet") })
    await expect(import("../../orchestrator.js")).rejects.toThrow("invalid wallet")
    expect(mocks.startWorker).not.toHaveBeenCalled()
  })

  it("starts normally without external wallet configuration", async () => {
    vi.stubEnv("DEPLOYMENT_WALLET_URL", "")
    vi.stubEnv("DEPLOYMENT_WALLET_TOKEN", "")
    vi.stubEnv("DEPLOYMENT_WALLET_SSO_PROVIDER", "")
    await import("../../orchestrator.js")
    expect(mocks.events).toEqual(["overlay", "worker"])
  })
})

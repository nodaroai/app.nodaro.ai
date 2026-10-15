import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { webhooksCommand } from "../webhooks.js"

const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  rotateSecret: vi.fn(),
  deliveries: vi.fn(),
  getDelivery: vi.fn(),
  test: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ webhooks: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

const output = vi.hoisted(() => ({ emit: vi.fn(), success: vi.fn(), table: vi.fn(), dim: vi.fn(), detail: vi.fn(), info: vi.fn(), warn: vi.fn() }))
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, ...output }
})

const ENDPOINT = {
  id: "e1",
  url: "https://hooks.example.com/in",
  description: null,
  events: ["job.completed", "job.failed"],
  isActive: true,
  disabledReason: null,
  disabledAt: null,
  consecutiveFailures: 0,
  appId: null,
  secretCreatedAt: "",
  createdAt: "",
  updatedAt: "",
}

const PING = {
  id: "d1", webhookId: "e1", event: "ping", jobId: null, status: "pending", attempts: 0, responseStatus: null,
  responseBody: null, durationMs: null, error: null, requestBody: null, createdAt: "", lastAttemptAt: null,
  nextAttemptAt: "", deliveredAt: null,
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(webhooksCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("webhooks command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    for (const m of Object.values(output)) m.mockReset()
  })

  it("create sends the address, events and description, and prints the secret it gets once", async () => {
    mocks.create.mockResolvedValueOnce({ data: ENDPOINT, secret: "whsec_once" })
    await runCmd("webhooks", "create", "--url", "https://hooks.example.com/in", "--events", "job.failed,job.completed", "--description", "orders")
    expect(mocks.create).toHaveBeenCalledWith({
      url: "https://hooks.example.com/in",
      events: ["job.failed", "job.completed"],
      description: "orders",
    })
    const printed = output.info.mock.calls.map((c) => String(c[0])).join("\n")
    expect(printed).toContain("whsec_once")
  })

  it("create --json emits the endpoint and the secret together", async () => {
    mocks.create.mockResolvedValueOnce({ data: ENDPOINT, secret: "whsec_once" })
    await runCmd("webhooks", "create", "--url", "https://hooks.example.com/in", "--json")
    expect(mocks.create).toHaveBeenCalledWith({ url: "https://hooks.example.com/in", events: undefined, description: undefined })
    expect(output.emit).toHaveBeenCalledWith({ data: ENDPOINT, secret: "whsec_once" }, expect.objectContaining({ json: true }))
  })

  it("create refuses an event it does not know, without calling the API", async () => {
    await expect(runCmd("webhooks", "create", "--url", "https://hooks.example.com/in", "--events", "job.started")).rejects.toThrow(/job\.started/)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("list and get read the endpoints", async () => {
    mocks.list.mockResolvedValueOnce({ data: [ENDPOINT] })
    mocks.get.mockResolvedValueOnce({ data: ENDPOINT })
    await runCmd("webhooks", "list")
    await runCmd("webhooks", "get", "e1")
    expect(mocks.list).toHaveBeenCalled()
    expect(mocks.get).toHaveBeenCalledWith("e1")
    expect(output.table).toHaveBeenCalled()
  })

  it("update switches on, changes events, and clears the description", async () => {
    mocks.update.mockResolvedValue({ data: ENDPOINT })
    await runCmd("webhooks", "update", "e1", "--enable", "--events", "job.failed", "--clear-description")
    expect(mocks.update).toHaveBeenLastCalledWith("e1", { url: undefined, events: ["job.failed"], isActive: true, description: null })
    await runCmd("webhooks", "update", "e1", "--disable")
    expect(mocks.update).toHaveBeenLastCalledWith("e1", { url: undefined, events: undefined, isActive: false, description: undefined })
  })

  it("update with nothing to change refuses without calling the API", async () => {
    await expect(runCmd("webhooks", "update", "e1")).rejects.toThrow(/nothing to update/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rotate-secret prints the new secret, and until when the old one still signs", async () => {
    mocks.rotateSecret.mockResolvedValueOnce({ secret: "whsec_new", previousSecretExpiresAt: "2026-10-16T10:00:00Z" })
    await runCmd("webhooks", "rotate-secret", "e1")
    expect(mocks.rotateSecret).toHaveBeenCalledWith("e1", {})
    const printed = output.info.mock.calls.map((c) => String(c[0])).join("\n")
    expect(printed).toContain("whsec_new")
    expect(printed).toContain("2026-10-16T10:00:00Z")
  })

  it("rotate-secret --grace sets how long the old secret keeps signing (0 = stop it now)", async () => {
    mocks.rotateSecret.mockResolvedValueOnce({ secret: "whsec_new", previousSecretExpiresAt: null })
    await runCmd("webhooks", "rotate-secret", "e1", "--grace", "0")
    expect(mocks.rotateSecret).toHaveBeenCalledWith("e1", { gracePeriodSeconds: 0 })
    await expect(runCmd("webhooks", "rotate-secret", "e1", "--grace", "soon")).rejects.toThrow(/grace/)
  })

  it("deliveries forwards the filters and page", async () => {
    mocks.deliveries.mockResolvedValueOnce({ data: [PING], next: "c2" })
    await runCmd("webhooks", "deliveries", "e1", "--status", "failed", "--limit", "5", "--cursor", "c1")
    expect(mocks.deliveries).toHaveBeenCalledWith("e1", { status: "failed", limit: 5, cursor: "c1" })
    expect(output.dim).toHaveBeenCalledWith("next: --cursor c2")
  })

  it("test queues a ping; --wait follows that delivery, by its id, to its result", async () => {
    mocks.test.mockResolvedValueOnce({ data: PING })
    mocks.getDelivery
      .mockResolvedValueOnce({ data: PING })
      .mockResolvedValueOnce({ data: { ...PING, status: "delivered", attempts: 1, responseStatus: 200 } })
    await runCmd("webhooks", "test", "e1", "--wait", "--poll-interval", "1")
    expect(mocks.test).toHaveBeenCalledWith("e1")
    expect(mocks.getDelivery).toHaveBeenCalledWith("e1", "d1")
    expect(mocks.deliveries).not.toHaveBeenCalled()
    expect(output.success).toHaveBeenCalledWith(expect.stringContaining("200"))
  })

  it("prints a receiver's answer without the control characters a terminal would act on", async () => {
    mocks.test.mockResolvedValueOnce({ data: PING })
    mocks.getDelivery.mockResolvedValueOnce({
      data: { ...PING, status: "failed", attempts: 1, responseStatus: 500, error: "http_500", responseBody: "boom\u001b]0;pwned\u0007\u001b[2J" },
    })
    await runCmd("webhooks", "test", "e1", "--wait", "--poll-interval", "1")
    const line = String(output.warn.mock.calls[0]?.[0])
    expect(line).toContain("boom")
    expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  it("delete calls the API with the id", async () => {
    mocks.delete.mockResolvedValueOnce({ success: true })
    await runCmd("webhooks", "delete", "e1")
    expect(mocks.delete).toHaveBeenCalledWith("e1")
  })
})

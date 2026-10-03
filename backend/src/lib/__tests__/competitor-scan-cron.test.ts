import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../config.js", async (orig) => ({
  ...(await orig<typeof import("../config.js")>()),
  hasCredits: () => true,
}))

import { competitorScanTick, resetCompetitorScanCronForTests } from "../competitor-scan-cron.js"

const appWith = (impl: () => Promise<{ statusCode: number }>) => ({ inject: vi.fn(impl) })

beforeEach(() => {
  resetCompetitorScanCronForTests()
  process.env.COMPETITOR_SCAN_CRON_ENABLED = "true"
})
afterEach(() => {
  delete process.env.COMPETITOR_SCAN_CRON_ENABLED
})

describe("competitorScanTick", () => {
  it("does nothing unless switched on (a scheduled scan spends credits)", async () => {
    delete process.env.COMPETITOR_SCAN_CRON_ENABLED
    const app = appWith(async () => ({ statusCode: 200 }))
    expect(await competitorScanTick(app as never)).toBe("disabled")
    expect(app.inject).not.toHaveBeenCalled()
  })

  it("calls the plugin's tick with the internal secret, and nothing else", async () => {
    const app = appWith(async () => ({ statusCode: 200 }))
    expect(await competitorScanTick(app as never)).toBe("ran")
    const call = (app.inject.mock.calls[0] as unknown[])[0] as { url: string; method: string; headers: Record<string, string> }
    expect(call).toMatchObject({ method: "POST", url: "/v1/competitors/internal/tick" })
    expect(Object.keys(call.headers)).toEqual(["x-internal-orchestrator-secret"])
  })

  it("never overlaps itself", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const app = appWith(async () => {
      await gate
      return { statusCode: 200 }
    })
    const first = competitorScanTick(app as never)
    expect(await competitorScanTick(app as never)).toBe("skipped")
    release()
    expect(await first).toBe("ran")
  })

  it("switches itself off for good when the plugin is not loaded, and keeps going after a passing failure", async () => {
    const gone = appWith(async () => ({ statusCode: 404 }))
    expect(await competitorScanTick(gone as never)).toBe("ran")
    expect(await competitorScanTick(gone as never)).toBe("disabled")

    resetCompetitorScanCronForTests()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const flaky = appWith(async () => ({ statusCode: 500 }))
    expect(await competitorScanTick(flaky as never)).toBe("ran")
    expect(await competitorScanTick(flaky as never)).toBe("ran")
    errorSpy.mockRestore()
  })
})

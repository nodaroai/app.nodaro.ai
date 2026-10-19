import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { AlreadyRunningError, AppRunVersionChangedError, NodaroError } from "@nodaro/sdk/errors"
import { appsCommand, retryRefusalAdvice } from "../apps.js"
import { emit, success, warn } from "../../output.js"

/**
 * `nodaro apps run-retry` — a thin wrapper over the (separately tested)
 * `client.apps.resume`; these pin the wiring only the CLI has: the flags'
 * shape, the dry-run summary, and the advice printed after a refusal.
 */
const mocks = { resume: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ apps: { resume: mocks.resume } }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

/** Parsed as the real CLI does: the root program registers `-v, --version` (src/index.ts). */
async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride().version("9.9.9", "-v, --version")
  program.addCommand(appsCommand())
  await program.parseAsync(["node", "test", ...args])
}

const plan = {
  runId: "run-1",
  continuesExecutionId: "ex-failed",
  appVersion: 3,
  nodeIds: ["clip", "join"],
  steps: [
    { nodeId: "clip", type: "ugc-clip", label: "Clips" },
    { nodeId: "join", type: "combine-videos", label: null },
  ],
  estimatedCredits: 120,
  reusedClips: 2,
  sufficient: true,
  available: 900,
}

describe("apps run-retry", () => {
  beforeEach(() => {
    mocks.resume.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(success).mockReset()
    vi.mocked(warn).mockReset()
  })

  it("starts the Retry with no options by default", async () => {
    mocks.resume.mockResolvedValueOnce({ executionId: "ex-2", runId: "run-1", status: "pending", nodeIds: ["clip"] })
    await runCmd("apps", "run-retry", "my-app", "run-1")
    expect(mocks.resume).toHaveBeenCalledWith("my-app", "run-1", { version: undefined })
    expect(vi.mocked(success).mock.calls[0]![0]).toContain("execution ex-2 (pending)")
  })

  it("--dry-run asks for the plan and summarizes it; --json emits it as is", async () => {
    mocks.resume.mockResolvedValue({ data: plan })
    await runCmd("apps", "run-retry", "my-app", "run-1", "--dry-run", "--app-version", "3")
    expect(mocks.resume).toHaveBeenCalledWith("my-app", "run-1", { dryRun: true, version: 3 })
    const line = vi.mocked(success).mock.calls[0]![0]
    expect(line).toContain("2 step(s)")
    expect(line).toContain("about 120 credits")
    expect(line).toContain("2 finished clip(s)")
    await runCmd("apps", "run-retry", "my-app", "run-1", "--dry-run", "--json")
    expect(vi.mocked(emit).mock.calls[0]![0]).toEqual(plan)
  })

  it("--dry-run warns when the balance cannot cover the Retry", async () => {
    mocks.resume.mockResolvedValueOnce({ data: { ...plan, sufficient: false, available: 10 } })
    await runCmd("apps", "run-retry", "my-app", "run-1", "--dry-run")
    expect(vi.mocked(warn).mock.calls.map((c) => c[0]).join("\n")).toContain("10 available")
  })

  it("--app-version reaches the Retry through a program that owns -v, --version (the root's flag never claims it)", async () => {
    mocks.resume.mockResolvedValueOnce({ executionId: "ex-2", runId: "run-1", status: "pending", nodeIds: [] })
    await runCmd("apps", "run-retry", "my-app", "run-1", "--app-version", "2")
    expect(mocks.resume).toHaveBeenCalledWith("my-app", "run-1", { version: 2 })
  })

  it("--dry-run names the app credits when they, not the balance, stop it", async () => {
    mocks.resume.mockResolvedValueOnce({ data: { ...plan, sufficient: false, available: 900, appCreditsAllowance: 0 } })
    await runCmd("apps", "run-retry", "my-app", "run-1", "--dry-run")
    const printed = vi.mocked(warn).mock.calls.map((c) => c[0]).join("\n")
    expect(printed).toContain("no app credits left")
    expect(printed).not.toContain("900 available")
  })

  it("refuses an --app-version that is not a whole positive number before any request", async () => {
    await expect(runCmd("apps", "run-retry", "my-app", "run-1", "--app-version", "2.5")).rejects.toThrow(/--app-version/)
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it("a version change prints how to start over and how to continue on the run's version", async () => {
    mocks.resume.mockRejectedValueOnce(new AppRunVersionChangedError("changed", 2, 3))
    await expect(runCmd("apps", "run-retry", "my-app", "run-1")).rejects.toBeInstanceOf(AppRunVersionChangedError)
    const printed = vi.mocked(warn).mock.calls.map((c) => c[0]).join("\n")
    expect(printed).toContain("nodaro apps run my-app")
    expect(printed).toContain("nodaro apps run-retry my-app run-1 --app-version 2")
  })
})

describe("retryRefusalAdvice", () => {
  it("a run that did not fail, or whose version is gone, is started over", () => {
    for (const code of ["continuation_not_failed", "app_run_version_unavailable"]) {
      const advice = retryRefusalAdvice("my-app", "run-1", new NodaroError("no", code, 409))
      expect(advice).toHaveLength(1)
      expect(advice[0]).toContain("nodaro apps run my-app")
    }
  })
  it("a run still running is followed: its live execution when the answer names it, else the run", () => {
    expect(retryRefusalAdvice("my-app", "run-1", new AlreadyRunningError("busy", "ex-live"))[0]).toContain("nodaro executions get ex-live --watch")
    expect(retryRefusalAdvice("my-app", "run-1", new NodaroError("busy", "already_running", 409))[0]).toContain("nodaro apps run-get my-app run-1")
  })
  it("a Retry that would stop at a Preview is sent to the app page", () => {
    expect(retryRefusalAdvice("my-app", "run-1", new NodaroError("held", "preview_review_required", 400))[0]).toContain("app page")
  })
  it("any other refusal adds nothing", () => {
    expect(retryRefusalAdvice("my-app", "run-1", new NodaroError("locked", "locked_field", 400))).toEqual([])
    expect(retryRefusalAdvice("my-app", "run-1", new Error("network"))).toEqual([])
  })
})

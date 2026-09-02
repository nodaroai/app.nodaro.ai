import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { orgCommand } from "../org.js"
import { workspaceCommand } from "../workspace.js"

/**
 * P15 usage CLI — thin wrappers over the (separately tested) SDK. These pin the
 * wiring that lives only in the CLI: flags shaped into the SDK call, --group-by
 * none dispatching to usageRows, --csv writing the SDK text verbatim to stdout,
 * and the missing-workspace message.
 */
const org = { usage: vi.fn(), usageRows: vi.fn(), usageCsv: vi.fn() }
const ws = { usage: vi.fn(), usageRows: vi.fn(), usageCsv: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ organizations: org, workspaces: ws }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), detail: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

vi.mock("../../workspace.js", () => ({
  resolveWorkspace: vi.fn(() => ({ workspaceId: undefined, source: "none" })),
  saveWorkspace: vi.fn(),
}))

vi.mock("../../config.js", () => ({ getProfile: () => ({ profile: {} }) }))

const EMPTY_REPORT = {
  data: {
    rows: [],
    variance: [],
    totals: { runCount: 0, credits: 0, settledCredits: 0, inFlightCredits: 0, platformAbsorbedCredits: 0, chargedToBudget: 0 },
    truncated: false,
  },
}

async function run(factory: () => Command, ...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(factory())
  await program.parseAsync(["node", "test", ...args])
}

describe("nodaro org usage", () => {
  beforeEach(() => {
    for (const m of [org.usage, org.usageRows, org.usageCsv]) m.mockReset()
  })

  it("shapes the flags into the SDK report call", async () => {
    org.usage.mockResolvedValueOnce(EMPTY_REPORT)
    await run(orgCommand, "org", "usage", "org_1", "--from", "2026-09-01", "--to", "2026-09-30", "--tz", "Asia/Jerusalem", "--group-by", "member", "--json")
    expect(org.usage).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ from: "2026-09-01", to: "2026-09-30", tz: "Asia/Jerusalem", groupBy: "member" }),
    )
  })

  it("--group-by none dispatches to usageRows, not usage", async () => {
    org.usageRows.mockResolvedValueOnce({ data: [], nextCursor: null })
    await run(orgCommand, "org", "usage", "org_1", "--group-by", "none", "--json")
    expect(org.usageRows).toHaveBeenCalledTimes(1)
    expect(org.usage).not.toHaveBeenCalled()
  })

  it("--csv writes the SDK text verbatim to stdout", async () => {
    org.usageCsv.mockResolvedValueOnce("group,runs,credits\r\ntotal,1,5\r\n")
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    await run(orgCommand, "org", "usage", "org_1", "--csv")
    expect(org.usageCsv).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith("group,runs,credits\r\ntotal,1,5\r\n")
    spy.mockRestore()
  })
})

describe("nodaro workspace usage", () => {
  beforeEach(() => {
    for (const m of [ws.usage, ws.usageRows, ws.usageCsv]) m.mockReset()
  })

  it("errors with a clear message when no id is given and none is selected", async () => {
    await expect(run(workspaceCommand, "workspace", "usage")).rejects.toThrow(/no workspace selected/)
  })

  it("uses the positional id when given", async () => {
    ws.usage.mockResolvedValueOnce(EMPTY_REPORT)
    await run(workspaceCommand, "workspace", "usage", "ws_1", "--json")
    expect(ws.usage).toHaveBeenCalledWith("ws_1", expect.objectContaining({ groupBy: "day" }))
  })
})

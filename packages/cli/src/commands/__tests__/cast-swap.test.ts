import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { info, success, dim, emit } from "../../output.js"
import { castSwapCommand } from "../cast-swap.js"

const mocks = {
  fullQuality: vi.fn(),
  fullQualityEstimate: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ castSwap: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), dim: vi.fn(), info: vi.fn() }
})

/** Commander's own refusals (an unknown option or subcommand) throw at every level instead of exiting. */
function quiet(cmd: Command): Command {
  cmd.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} })
  for (const sub of cmd.commands) quiet(sub)
  return cmd
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command()
  program.addCommand(castSwapCommand())
  await quiet(program).parseAsync(["node", "test", ...args])
}

const QUOTE = { totalCredits: 12, breakdown: { castSwap: 5, seedanceHd: 7 }, availableUntil: "2026-10-28T10:00:00.000Z" }

describe("cast-swap full-quality", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    vi.mocked(info).mockReset()
    vi.mocked(success).mockReset()
    vi.mocked(dim).mockReset()
    vi.mocked(emit).mockReset()
  })

  it("estimate quotes the draft and never starts it", async () => {
    mocks.fullQualityEstimate.mockResolvedValueOnce(QUOTE)
    await runCmd("cast-swap", "full-quality", "estimate", "draft-1")
    expect(mocks.fullQualityEstimate).toHaveBeenCalledWith("draft-1")
    expect(mocks.fullQuality).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining("about 12 credits"))
    expect(vi.mocked(dim).mock.calls.flat().join("\n")).toContain("2026-10-28T10:00:00.000Z")
  })

  it("estimate --json emits the quote as it came", async () => {
    mocks.fullQualityEstimate.mockResolvedValueOnce(QUOTE)
    await runCmd("cast-swap", "full-quality", "estimate", "draft-1", "--json")
    expect(emit).toHaveBeenCalledWith(QUOTE, expect.objectContaining({ json: true }))
  })

  it("estimate says a Kling 4 run's Full Quality is a new take, and lists every part", async () => {
    mocks.fullQualityEstimate.mockResolvedValueOnce({ kind: "new-take", totalCredits: 420, breakdown: { castSwap: 40, kling: 380 }, availableUntil: "2026-10-28T10:00:00.000Z" })
    await runCmd("cast-swap", "full-quality", "estimate", "run-720")
    const out = vi.mocked(dim).mock.calls.flat().join("\n")
    expect(out).toMatch(/new take/i)
    expect(out).toContain("kling: 380")
    expect(out).not.toMatch(/reuse/i)
  })

  it("estimate says a quote with no kind (an older engine) is the same take", async () => {
    mocks.fullQualityEstimate.mockResolvedValueOnce(QUOTE)
    await runCmd("cast-swap", "full-quality", "estimate", "draft-1")
    expect(vi.mocked(dim).mock.calls.flat().join("\n")).toContain("the same take at 1080p")
  })

  it("estimate says when an earlier render is reused", async () => {
    mocks.fullQualityEstimate.mockResolvedValueOnce({ ...QUOTE, totalCredits: 5, breakdown: { castSwap: 5, seedanceHd: 0 } })
    await runCmd("cast-swap", "full-quality", "estimate", "draft-1")
    expect(vi.mocked(dim).mock.calls.flat().join("\n")).toMatch(/reuse/i)
  })

  it("estimate takes no --session: refused before anything is sent", async () => {
    await expect(runCmd("cast-swap", "full-quality", "estimate", "draft-1", "--session", "s-1")).rejects.toThrow(/--session/)
    expect(mocks.fullQualityEstimate).not.toHaveBeenCalled()
    expect(mocks.fullQuality).not.toHaveBeenCalled()
  })

  it("run starts Full Quality with the session and prints the job to follow", async () => {
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-1" })
    await runCmd("cast-swap", "full-quality", "run", "draft-1", "--session", "s-1")
    expect(mocks.fullQuality).toHaveBeenCalledWith("draft-1", { sessionId: "s-1" })
    expect(mocks.fullQualityEstimate).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith(expect.stringContaining("fq-1"))
    expect(dim).toHaveBeenCalledWith("follow it: nodaro jobs get fq-1")
  })

  it("run starts without a session when none is given", async () => {
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-1" })
    await runCmd("cast-swap", "full-quality", "run", "draft-1")
    expect(mocks.fullQuality).toHaveBeenCalledWith("draft-1", {})
  })

  it("run says when the draft's Full Quality already exists", async () => {
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-0", existing: true })
    await runCmd("cast-swap", "full-quality", "run", "draft-1")
    expect(success).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/already.*fq-0/))
  })

  it("run --json emits the run's answer", async () => {
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-1" })
    await runCmd("cast-swap", "full-quality", "run", "draft-1", "--json")
    expect(emit).toHaveBeenCalledWith({ jobId: "fq-1" }, expect.objectContaining({ json: true }))
  })

  it("run prints the server's job id terminal-safe", async () => {
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-1\u001b[2Jx" })
    await runCmd("cast-swap", "full-quality", "run", "draft-1")
    mocks.fullQuality.mockResolvedValueOnce({ jobId: "fq-0\u001b[2Jx", existing: true })
    await runCmd("cast-swap", "full-quality", "run", "draft-1")
    const printed = [success, info, dim].flatMap((fn) => vi.mocked(fn).mock.calls.flat()).join("\n")
    expect(printed).not.toContain("\u001b")
    expect(printed).toContain("fq-1\uFFFD[2Jx")
    expect(printed).toContain("fq-0\uFFFD[2Jx")
  })

  it("a bare full-quality <jobId> spends nothing: the subcommand must be named", async () => {
    await expect(runCmd("cast-swap", "full-quality", "draft-1")).rejects.toThrow(/unknown command 'draft-1'/)
    expect(mocks.fullQuality).not.toHaveBeenCalled()
    expect(mocks.fullQualityEstimate).not.toHaveBeenCalled()
  })
})

import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { ContinuationPreviewPendingError } from "@nodaro/sdk/errors"
import { previewPendingCommand, shellQuote, workflowsCommand } from "../workflows.js"

/**
 * P11 CLI subcommands — share / move / shared-with-me / collaborators. The
 * commands are thin wrappers over the (separately tested) SDK, so these tests
 * pin the wiring that lives ONLY in the CLI: argument shaping and the two
 * local validations (exactly-one-of user/email, and the role/visibility enums).
 */
const mocks = {
  setVisibility: vi.fn(),
  move: vi.fn(),
  sharedWithMe: vi.fn(),
  collabList: vi.fn(),
  collabAdd: vi.fn(),
  collabUpdate: vi.fn(),
  collabRemove: vi.fn(),
  run: vi.fn(),
  get: vi.fn(),
  renderFinal: vi.fn(),
  estimateRenderFinal: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    workflows: {
      setVisibility: mocks.setVisibility,
      move: mocks.move,
      sharedWithMe: mocks.sharedWithMe,
      run: mocks.run,
      get: mocks.get,
      renderFinal: mocks.renderFinal,
      estimateRenderFinal: mocks.estimateRenderFinal,
      collaborators: {
        list: mocks.collabList,
        add: mocks.collabAdd,
        update: mocks.collabUpdate,
        remove: mocks.collabRemove,
      },
    },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(workflowsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("workflows command — P11 subcommands", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("share defaults to workspace visibility", async () => {
    mocks.setVisibility.mockResolvedValueOnce({ data: { id: "wf-1" } })
    await runCmd("workflows", "share", "wf-1", "--json")
    expect(mocks.setVisibility).toHaveBeenCalledWith("wf-1", "workspace")
  })

  it("share --visibility private is forwarded", async () => {
    mocks.setVisibility.mockResolvedValueOnce({ data: { id: "wf-1" } })
    await runCmd("workflows", "share", "wf-1", "--visibility", "private", "--json")
    expect(mocks.setVisibility).toHaveBeenCalledWith("wf-1", "private")
  })

  it("share rejects an unknown visibility", async () => {
    await expect(runCmd("workflows", "share", "wf-1", "--visibility", "public")).rejects.toThrow(/workspace.*private/)
    expect(mocks.setVisibility).not.toHaveBeenCalled()
  })

  it("move forwards the destination project", async () => {
    mocks.move.mockResolvedValueOnce({ data: { id: "wf-1" }, droppedCollaborators: [] })
    await runCmd("workflows", "move", "wf-1", "--project", "proj-2", "--json")
    expect(mocks.move).toHaveBeenCalledWith("wf-1", { projectId: "proj-2" })
  })

  it("shared-with-me calls the SDK", async () => {
    mocks.sharedWithMe.mockResolvedValueOnce({ data: [] })
    await runCmd("workflows", "shared-with-me", "--json")
    expect(mocks.sharedWithMe).toHaveBeenCalledTimes(1)
  })

  it("collaborators add by email forwards email + role", async () => {
    mocks.collabAdd.mockResolvedValueOnce({ data: { userId: "u2", role: "editor" } })
    await runCmd("workflows", "collaborators", "add", "wf-1", "--email", "dana@example.com", "--role", "editor", "--json")
    expect(mocks.collabAdd).toHaveBeenCalledWith("wf-1", { email: "dana@example.com", role: "editor" })
  })

  it("collaborators add rejects giving BOTH user and email", async () => {
    await expect(
      runCmd("workflows", "collaborators", "add", "wf-1", "--user", "u2", "--email", "d@e.com", "--role", "editor"),
    ).rejects.toThrow(/exactly one/)
    expect(mocks.collabAdd).not.toHaveBeenCalled()
  })

  it("collaborators add rejects an unknown role", async () => {
    await expect(
      runCmd("workflows", "collaborators", "add", "wf-1", "--user", "u2", "--role", "owner"),
    ).rejects.toThrow(/viewer.*editor/)
    expect(mocks.collabAdd).not.toHaveBeenCalled()
  })

  it("collaborators update forwards the per-user role", async () => {
    mocks.collabUpdate.mockResolvedValueOnce({ data: { userId: "u2", role: "viewer" } })
    await runCmd("workflows", "collaborators", "update", "wf-1", "u2", "--role", "viewer", "--json")
    expect(mocks.collabUpdate).toHaveBeenCalledWith("wf-1", "u2", { role: "viewer" })
  })

  it("collaborators remove forwards workflow + user", async () => {
    mocks.collabRemove.mockResolvedValueOnce({ success: true })
    await runCmd("workflows", "collaborators", "remove", "wf-1", "u2", "--json")
    expect(mocks.collabRemove).toHaveBeenCalledWith("wf-1", "u2")
  })
})

describe("workflows run — continuing an earlier execution", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending" })
  })

  it("--continue-from --from-failed resumes the failed run; nodes may be left out", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { continueFromExecutionId: "ex-failed", continueMode: "from-failed" })
  })

  it("says where a continuation's states came from when the server built it on a later continuation", async () => {
    const { dim } = await import("../../output.js")
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending", continuedFrom: "ex-later" })
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed")
    expect(vi.mocked(dim)).toHaveBeenCalledWith(expect.stringContaining("continued from ex-later"))
    vi.mocked(dim).mockClear()
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending", continuedFrom: "ex-failed" })
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed")
    expect(vi.mocked(dim)).not.toHaveBeenCalledWith(expect.stringContaining("continued from"))
  })

  it("--from-failed keeps --node as the nodes to consider", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--node", "a", "b", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { nodeIds: ["a", "b"], continueFromExecutionId: "ex-failed", continueMode: "from-failed" })
  })

  it("--continue-from alone is a plain continuation of the named nodes", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-done", "--node", "cut", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { nodeIds: ["cut"], continueFromExecutionId: "ex-done" })
  })

  it("--idempotency-key is sent as the run's Idempotency-Key", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed", "--idempotency-key", "retry-key-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { continueFromExecutionId: "ex-failed", continueMode: "from-failed" }, { idempotencyKey: "retry-key-1" })
  })

  it("an --idempotency-key shorter than the server reads is refused locally", async () => {
    await expect(runCmd("workflows", "run", "wf-1", "--idempotency-key", "short")).rejects.toThrow(/at least 8 characters/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("--from-failed without --continue-from is refused locally", async () => {
    await expect(runCmd("workflows", "run", "wf-1", "--from-failed")).rejects.toThrow(/--continue-from/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("a plain run sends nothing extra", async () => {
    await runCmd("workflows", "run", "wf-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", {})
  })
})

describe("workflows run — per-node overrides and a held continuation's `next`", () => {
  const next = {
    continueFromExecutionId: "ex-held",
    nodeIds: ["cut1", "cut2", "t", "mix"],
    inputOverrides: {
      cut1: { quality: "final" },
      t: { useCaseContinue: { mode: "render-final", jobId: "w", settings: { instructions: "keep the host's intro" } } },
    },
  }

  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    mocks.run.mockResolvedValue({ executionId: "ex-new", status: "pending" })
  })

  it("--override sends nested inputOverrides with the run", async () => {
    await runCmd("workflows", "run", "wf-1", "--continue-from", "ex-done", "--node", "cut", "--override", "cut.quality=final", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", {
      nodeIds: ["cut"],
      inputOverrides: { cut: { quality: "final" } },
      continueFromExecutionId: "ex-done",
    })
  })

  it("--next sends the body exactly as given, every field it carries (inline JSON)", async () => {
    await runCmd("workflows", "run", "wf-1", "--next", JSON.stringify({ ...next, laterField: 1 }), "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", { ...next, laterField: 1 })
  })

  it("--next reads a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nodaro-next-"))
    const file = join(dir, "next.json")
    writeFileSync(file, JSON.stringify(next))
    await runCmd("workflows", "run", "wf-1", "--next", file, "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", next)
  })

  it("--next with --idempotency-key keeps the key", async () => {
    await runCmd("workflows", "run", "wf-1", "--next", JSON.stringify(next), "--idempotency-key", "retry-key-1", "--json")
    expect(mocks.run).toHaveBeenCalledWith("wf-1", next, { idempotencyKey: "retry-key-1" })
  })

  it.each([
    ["--node", ["--node", "a"]],
    ["--continue-from", ["--continue-from", "ex-1"]],
    ["--from-failed", ["--continue-from", "ex-1", "--from-failed"]],
    ["--override", ["--override", "a.b=1"]],
  ])("--next is refused with %s (it would send another run)", async (_flag, extra) => {
    await expect(runCmd("workflows", "run", "wf-1", "--next", JSON.stringify(next), ...extra)).rejects.toThrow(/--next is the whole run/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it.each([
    ["not JSON", "{nope"],
    ["no execution", JSON.stringify({ nodeIds: ["a"], inputOverrides: {} })],
    ["no nodes", JSON.stringify({ continueFromExecutionId: "ex", nodeIds: [], inputOverrides: {} })],
    ["overrides not an object", JSON.stringify({ continueFromExecutionId: "ex", nodeIds: ["a"], inputOverrides: [] })],
    ["a continueMode inside it", JSON.stringify({ continueFromExecutionId: "ex", nodeIds: ["a"], continueMode: "from-failed" })],
    ["a renderFinal inside it", JSON.stringify({ continueFromExecutionId: "ex", nodeIds: ["a"], renderFinal: { renderNodeId: "a" } })],
  ])("--next refuses a body that is not a `next` (%s)", async (_name, body) => {
    await expect(runCmd("workflows", "run", "wf-1", "--next", body)).rejects.toThrow(/--next/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("a continue-from-failed refused continuation_preview_pending prints the exact command that finishes it", async () => {
    const { warn } = await import("../../output.js")
    vi.mocked(warn).mockClear()
    mocks.run.mockRejectedValue(new ContinuationPreviewPendingError("held", "ex-held", ["cut1", "cut2"], ["t"], next))
    await expect(runCmd("workflows", "run", "wf-1", "--continue-from", "ex-failed", "--from-failed")).rejects.toBeInstanceOf(
      ContinuationPreviewPendingError,
    )
    const printed = vi.mocked(warn).mock.calls.map((c) => String(c[0]))
    const command = printed.find((l) => l.includes("nodaro workflows run"))!.trim()
    expect(command).toBe(`nodaro workflows run wf-1 --next ${shellQuote(JSON.stringify(next))}`)
  })

  it("…and for one held render, its render-final", () => {
    const err = new ContinuationPreviewPendingError("held", "ex-held", ["cut"], [], {
      continueFromExecutionId: "ex-held",
      nodeIds: ["cut", "cap"],
      inputOverrides: { cut: { quality: "final" } },
    })
    expect(previewPendingCommand("wf-1", err)).toBe("nodaro workflows render-final wf-1 --from ex-held --render cut")
    // Nothing the server could name: nothing printed.
    expect(previewPendingCommand("wf-1", new ContinuationPreviewPendingError("held", "ex-held", ["a", "b"], [], undefined))).toBeNull()
  })
})

describe("shellQuote", () => {
  it.each([
    ["plain", "wf-1"],
    ["an apostrophe in free text", `{"instructions":"keep the host's intro"}`],
    ["several apostrophes and spaces", "it's 'quoted' twice"],
    ["shell syntax", "$(rm -rf /) `x` \\ ; | & > *"],
    ["empty", ""],
    ["a leading =", "=ls"],
  ])("%s survives a POSIX shell as one argument", (_name, word) => {
    const echoed = execFileSync("sh", ["-c", `printf '%s' ${shellQuote(word)}`], { encoding: "utf8" })
    expect(echoed).toBe(word)
  })

  it("quotes a word that starts with = (zsh expands =cmd to the command's path); an = later in a word stays plain", () => {
    expect(shellQuote("=ls")).toBe("'=ls'")
    expect(shellQuote("a=b")).toBe("a=b")
  })

  it.runIf(hasZsh())("a leading = survives zsh as one argument", () => {
    for (const word of ["=ls", "=not-a-command-anywhere"]) {
      expect(execFileSync("zsh", ["-fc", `printf '%s' ${shellQuote(word)}`], { encoding: "utf8" })).toBe(word)
    }
  })
})

function hasZsh(): boolean {
  try {
    execFileSync("zsh", ["-fc", "true"])
    return true
  } catch {
    return false
  }
}

describe("workflows render-final", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    mocks.renderFinal.mockResolvedValue({ executionId: "ex-final", status: "pending" })
  })

  it("--render names the render; the server works out the rest", async () => {
    await runCmd("workflows", "render-final", "wf-1", "--from", "ex-preview", "--render", "cut", "--json")
    expect(mocks.renderFinal).toHaveBeenCalledWith("wf-1", { renderNodeId: "cut", continueFromExecutionId: "ex-preview" })
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it("without --render, the workflow's only render", async () => {
    mocks.get.mockResolvedValue({
      data: { nodes: [{ id: "p", type: "edit-plan" }, { id: "cut", type: "apply-edl" }, { id: "c", type: "add-captions" }] },
    })
    await runCmd("workflows", "render-final", "wf-1", "--from", "ex-preview", "--json")
    expect(mocks.renderFinal).toHaveBeenCalledWith("wf-1", { renderNodeId: "cut", continueFromExecutionId: "ex-preview" })
  })

  it("without --render, several renders are refused, naming them", async () => {
    mocks.get.mockResolvedValue({ data: { nodes: [{ id: "cut1", type: "apply-edl" }, { id: "cut2", type: "speaker-view" }] } })
    await expect(runCmd("workflows", "render-final", "wf-1", "--from", "ex-preview")).rejects.toThrow(/--render: cut1, cut2/)
    expect(mocks.renderFinal).not.toHaveBeenCalled()
  })

  it("without --render, a workflow with no render is refused", async () => {
    mocks.get.mockResolvedValue({ data: { nodes: [{ id: "c", type: "add-captions" }] } })
    await expect(runCmd("workflows", "render-final", "wf-1", "--from", "ex-preview")).rejects.toThrow(/no render node/)
  })

  it("--from is required", async () => {
    await expect(runCmd("workflows", "render-final", "wf-1", "--render", "cut")).rejects.toThrow()
    expect(mocks.renderFinal).not.toHaveBeenCalled()
  })

  it("--estimate quotes it and runs nothing", async () => {
    const { emit } = await import("../../output.js")
    const quote = { renderNodeId: "cut", nodeIds: ["cut", "c"], inputOverrides: { cut: { quality: "final" } }, estimatedCredits: 50, sufficient: true, available: 900 }
    mocks.estimateRenderFinal.mockResolvedValue({ data: quote })
    await runCmd("workflows", "render-final", "wf-1", "--from", "ex-preview", "--render", "cut", "--estimate", "--json")
    expect(mocks.estimateRenderFinal).toHaveBeenCalledWith("wf-1", { renderNodeId: "cut", continueFromExecutionId: "ex-preview" })
    expect(mocks.renderFinal).not.toHaveBeenCalled()
    expect(vi.mocked(emit)).toHaveBeenCalledWith(quote, expect.anything())
  })
})

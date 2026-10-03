import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Command } from "commander"

const estimate = vi.fn(async (_input: unknown) => ({ totalCredits: 1 }))
const create = vi.fn(async (_input: unknown) => ({ recastId: "r1" }))
const start = vi.fn(async (_id: string, _opts: unknown) => ({ gvpJobId: "g1" }))

vi.mock("../client.js", () => ({
  buildClient: () => ({ recast: { estimate, create, start } }),
  handleError: (err: unknown) => {
    throw err
  },
}))
vi.mock("../output.js", () => ({ detail: vi.fn(), emit: vi.fn(), success: vi.fn(), warn: vi.fn() }))

import { recastCommand } from "../commands/recast.js"

function run(args: string[]): Promise<Command> {
  const cmd = recastCommand()
  for (const sub of cmd.commands) {
    sub.exitOverride().configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
  }
  return cmd.parseAsync(args, { from: "user" })
}

/**
 * The API field is `segmentSec`, but it takes a pack name. The CLI used to
 * offer `--segment-sec <n>` and send a number of seconds, which the server
 * rejects.
 */
describe("recast --segment-pack", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sends the pack name as segmentSec on estimate, create and start", async () => {
    await run(["estimate", "--analysis-job", "a1", "--segment-pack", "max"])
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ segmentSec: "max" }))

    await run(["create", "--workflow", "w1", "--analysis-job", "a1", "--segment-pack", "scenes-max"])
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ segmentSec: "scenes-max" }))

    await run(["start", "r1", "--segment-pack", "scenes"])
    expect(start).toHaveBeenCalledWith("r1", { segmentSec: "scenes" })
  })

  it("leaves segmentSec unset when the option is not given", async () => {
    await run(["start", "r1"])
    expect(start).toHaveBeenCalledWith("r1", { segmentSec: undefined })
  })

  it("refuses a number of seconds before calling the API", async () => {
    await expect(run(["start", "r1", "--segment-pack", "8"])).rejects.toThrow(/Allowed choices/)
    expect(start).not.toHaveBeenCalled()
  })
})

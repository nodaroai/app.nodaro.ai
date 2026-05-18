import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { locationsCommand } from "../locations.js"

/**
 * Mocked SDK shape — every method the locations command touches needs an
 * impl. The `client` constant lives in module scope so each test can reach
 * into it via `client.locations.<method>` and assert the calls without
 * threading mocks through commander.
 *
 * Note on `process.exit`: the CLI's `handleError` calls `process.exit(1)` on
 * any thrown error, and we don't want that mid-test. We mock it to throw
 * instead so vitest sees a normal rejection and the test can assert on it.
 */
const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  restore: vi.fn(),
  generate: vi.fn(),
  generateAsset: vi.fn(),
  approveMainImage: vi.fn(),
  recaption: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    locations: {
      list: mocks.list,
      get: mocks.get,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      restore: mocks.restore,
      generate: mocks.generate,
      generateAsset: mocks.generateAsset,
      approveMainImage: mocks.approveMainImage,
      recaption: mocks.recaption,
    },
    jobs: { get: mocks.jobsGet },
  }),
  handleError: (err: unknown) => {
    // Surface the underlying error to vitest instead of process.exiting.
    throw err
  },
}))

// Don't print anything from `success`/`emit`/etc during the tests.
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
    table: vi.fn(),
  }
})

/**
 * Build a fresh `locations` command tree, attach it to a Command program, and
 * dispatch the given argv. Commander parses the first two argv elements as
 * `[node, script]`, so each test's args go AFTER those two placeholders.
 */
async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(locationsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("locations command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("list invokes client.locations.list with no options by default", async () => {
    mocks.list.mockResolvedValueOnce({ locations: [] })
    await runCmd("locations", "list", "--json")
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith({ archived: undefined })
  })

  it("list --archived forwards archived=true", async () => {
    mocks.list.mockResolvedValueOnce({ locations: [] })
    await runCmd("locations", "list", "--archived", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ archived: true })
  })

  it("get <id> calls locations.get with the id", async () => {
    mocks.get.mockResolvedValueOnce({ id: "loc-1", name: "Forest" })
    await runCmd("locations", "get", "loc-1", "--json")
    expect(mocks.get).toHaveBeenCalledWith("loc-1")
  })

  it("create requires --node-id and forwards every supplied field", async () => {
    mocks.create.mockResolvedValueOnce({ id: "new-id" })
    await runCmd(
      "locations",
      "create",
      "Mystic Forest",
      "--node-id",
      "node-1",
      "--description",
      "ancient woods",
      "--category",
      "nature",
      "--style",
      "realistic",
      "--json",
    )
    expect(mocks.create).toHaveBeenCalledWith({
      nodeId: "node-1",
      projectId: undefined,
      name: "Mystic Forest",
      description: "ancient woods",
      category: "nature",
      style: "realistic",
    })
  })

  it("update errors when no fields supplied", async () => {
    await expect(runCmd("locations", "update", "loc-1")).rejects.toThrow(
      /nothing to update/,
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("update only forwards the keys the user supplied", async () => {
    mocks.update.mockResolvedValueOnce({ id: "loc-1", updatedAt: "2026-05-18T00:00:00.000Z" })
    await runCmd("locations", "update", "loc-1", "--name", "New Name", "--json")
    expect(mocks.update).toHaveBeenCalledWith("loc-1", { name: "New Name" })
    // Confirm we didn't accidentally smuggle empty strings for other fields.
    const patch = mocks.update.mock.calls[0][1] as Record<string, unknown>
    expect(patch.description).toBeUndefined()
    expect(patch.styleLock).toBeUndefined()
  })

  it("update --style-lock parses 'true' / 'false' into booleans", async () => {
    mocks.update.mockResolvedValueOnce({ id: "loc-1", updatedAt: "2026-05-18T00:00:00.000Z" })
    await runCmd("locations", "update", "loc-1", "--style-lock", "false", "--json")
    expect(mocks.update).toHaveBeenCalledWith("loc-1", { styleLock: false })
  })

  it("update --style-lock rejects garbage values", async () => {
    await expect(
      runCmd("locations", "update", "loc-1", "--style-lock", "yes", "--json"),
    ).rejects.toThrow(/style-lock must be/)
  })

  it("delete soft-deletes via the SDK", async () => {
    mocks.delete.mockResolvedValueOnce({ success: true, archived: true })
    await runCmd("locations", "delete", "loc-1", "--json")
    expect(mocks.delete).toHaveBeenCalledWith("loc-1")
  })

  it("restore calls locations.restore with the id", async () => {
    mocks.restore.mockResolvedValueOnce({ id: "loc-1", name: "Forest" })
    await runCmd("locations", "restore", "loc-1", "--json")
    expect(mocks.restore).toHaveBeenCalledWith("loc-1")
  })

  it("generate requires --name and forwards count + attach", async () => {
    mocks.generate.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd(
      "locations",
      "generate",
      "--name",
      "Mystic Forest",
      "--count",
      "1",
      "--json",
    )
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    const arg = mocks.generate.mock.calls[0][0] as Record<string, unknown>
    expect(arg.name).toBe("Mystic Forest")
    expect(arg.count).toBe(1)
  })

  it("generate parses --count 4 as the literal 4 union member", async () => {
    mocks.generate.mockResolvedValueOnce({ jobIds: ["j1", "j2", "j3", "j4"] })
    await runCmd("locations", "generate", "--name", "Forest", "--count", "4", "--json")
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ count: 4 })
  })

  it("approve-main-image forwards id + candidate-job-id", async () => {
    mocks.approveMainImage.mockResolvedValueOnce({
      sourceImageUrl: "https://r2/x.png",
      canonicalDescription: "...",
    })
    await runCmd(
      "locations",
      "approve-main-image",
      "loc-1",
      "--candidate-job-id",
      "job-1",
      "--json",
    )
    expect(mocks.approveMainImage).toHaveBeenCalledWith("loc-1", "job-1")
  })

  it("recaption calls locations.recaption with the id", async () => {
    mocks.recaption.mockResolvedValueOnce({ canonicalDescription: "fresh" })
    await runCmd("locations", "recaption", "loc-1", "--json")
    expect(mocks.recaption).toHaveBeenCalledWith("loc-1")
  })

  it("generate-asset infers attachToColumn from canonical asset types", async () => {
    // The CLI fetches the location first to pull `name` + `description` so
    // it can fill those into the SDK payload. Mock both calls.
    mocks.get.mockResolvedValueOnce({ id: "loc-1", name: "Forest", description: null })
    mocks.generateAsset.mockResolvedValueOnce({ jobId: "asset-job-1" })
    await runCmd(
      "locations",
      "generate-asset",
      "loc-1",
      "--asset-type",
      "timeOfDay",
      "--variant",
      "dawn",
      "--json",
    )
    const arg = mocks.generateAsset.mock.calls[0][0] as Record<string, unknown>
    expect(arg.assetType).toBe("timeOfDay")
    // camelCase asset-type → snake_case column inferred without --column.
    expect(arg.attachToColumn).toBe("time_of_day")
    expect(arg.attachToLocationId).toBe("loc-1")
    expect(arg.attachName).toBe("dawn")
  })

  it("generate-asset requires --column for custom asset types", async () => {
    mocks.get.mockResolvedValueOnce({ id: "loc-1", name: "Forest", description: null })
    await expect(
      runCmd(
        "locations",
        "generate-asset",
        "loc-1",
        "--asset-type",
        "custom",
        "--variant",
        "my-custom",
        "--json",
      ),
    ).rejects.toThrow(/--column is required/)
    expect(mocks.generateAsset).not.toHaveBeenCalled()
  })
})
